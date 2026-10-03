import { useEffect, useMemo, useState } from "react";
import type { EntitySummary, Schedule } from "../../types";
import {
  draftFromSchedule,
  EMPTY_DRAFT,
  mergeClimateAttrs,
  mergeCoverAttrs,
  mergeFanAttrs,
  mergeLightAttrs,
  rangeDayOffset,
  validateScheduleDraft,
  type ScheduleDraft,
} from "../../utils/scheduleRange";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { ClimateActionEditor } from "../ClimateActionEditor/ClimateActionEditor";
import { CoverActionEditor } from "../CoverActionEditor/CoverActionEditor";
import { DaySelector } from "../DaySelector/DaySelector";
import { EntityPicker } from "../EntityPicker/EntityPicker";
import { FanActionEditor } from "../FanActionEditor/FanActionEditor";
import { LightActionEditor } from "../LightActionEditor/LightActionEditor";
import { OffsetStepper } from "../OffsetStepper/OffsetStepper";
import { TimeWheelPicker } from "../TimeWheelPicker/TimeWheelPicker";
import { api } from "../../services/api";
import { defaultConditionState } from "../../utils/conditionStates";
import { ConditionList } from "../ConditionList/ConditionList";
import { tr } from "../../i18n";
import { fmtTime, secondsOfDayInZone, todayInZone } from "../../utils/appTime";
import { actionChipLabel, domainProfile, type ActionService } from "../../utils/domainProfile";

const DOMAIN_ACTION_SERVICE = { climate: "climate_set", light: "light_set", cover: "cover_set", fan: "fan_set" } as const;

/** " (05:43)" - gio moc troi hom nay de hien ngay tren chip, tra ve rong neu
 * chua co (dang tai hoac chua lay duoc vi tri HA). */
function sunHint(iso: string | null): string {
  if (!iso) return "";
  return ` (${fmtTime(iso)})`;
}

/** Thoi luong cua lich "Tu tat" duoc tao/sua GAN NHAT (updated_at) - dung lam
 * mac dinh cho lich tu tat moi, nguoi dung do phai chon lai (phan hoi
 * 2026-09-30). Lay tu du lieu server nen dung chung moi thiet bi mo app. */
function lastAutoOffDuration(schedules: Schedule[]): string {
  const latest = schedules
    .filter((s) => s.trigger_type === "auto_off")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return latest?.time ?? "00:30:00";
}

/** 1 moc gio cua Khung gio: chip Gio/Binh minh/Hoang hon + wheel hoac +/- phut. */
function PointEditor({
  trigger,
  offset,
  time,
  sunTimes,
  onChange,
}: {
  trigger: "time" | "sunrise" | "sunset";
  offset: number;
  time: string;
  sunTimes: { sunrise: string | null; sunset: string | null };
  onChange: (trigger: "time" | "sunrise" | "sunset", offset: number, time: string) => void;
}) {
  const chip = (t: "time" | "sunrise" | "sunset", label: string) => (
    <button type="button" className={trigger === t ? "chip chip--active" : "chip"} onClick={() => onChange(t, t === trigger ? offset : 0, time)}>
      {label}
    </button>
  );
  return (
    <>
      <div className="chip-row chip-row--compact">
        {chip("time", tr("Giờ", "Time"))}
        {chip("sunrise", `🌅 ${tr("Bình minh", "Sunrise")}${sunHint(sunTimes.sunrise)}`)}
        {chip("sunset", `🌇 ${tr("Hoàng hôn", "Sunset")}${sunHint(sunTimes.sunset)}`)}
      </div>
      {trigger === "time" ? (
        <TimeWheelPicker value={time} onChange={(t) => onChange("time", 0, t)} />
      ) : (
        <OffsetStepper
          label={trigger === "sunrise" ? tr("Bình minh", "Sunrise") : tr("Hoàng hôn", "Sunset")}
          minutes={offset}
          baseTimeIso={trigger === "sunrise" ? sunTimes.sunrise : sunTimes.sunset}
          onChange={(m) => onChange(trigger, m, time)}
        />
      )}
    </>
  );
}

export function ScheduleEditor({
  open,
  schedule,
  allSchedules,
  entities,
  presetEntities,
  lockEntities,
  mode,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  schedule: Schedule | null;
  /** Toan bo schedule hien co - dung de tim "anh em" cung group_id khi sua
   * 1 lich dang "khung gio" (muc scheduleRange.ts). */
  allSchedules: Schedule[];
  entities: EntitySummary[];
  /** Chi dung khi tao moi (schedule=null) - vd tu Device Detail bam "+ Them
   * gio" thi thiet bi da biet truoc, bo qua buoc chon lai (muc 13 SPEC_UI.md). */
  presetEntities?: string[];
  /** An han nut "+ Chon thiet bi" (chi hien ten thiet bi, khong cho bam doi) -
   * phan hoi 2026-09-23 "đưa chỗ chọn thiết bị cho timer ra ngoài chỗ config
   * timer": mo tu Device Detail (sua gio 1 card co san) thi doi thiet bi gio
   * lam rieng o Device Detail (bam thang vao ten thiet bi tren dau trang),
   * khong con lam chung trong sheet cau hinh gio/ngay/dieu kien nay nua -
   * tranh 2 duong doi thiet bi khac nhau de gay lech du lieu. Sheet nay van
   * cho chon thiet bi binh thuong khi tao lich HOAN TOAN MOI tu trang Nha. */
  lockEntities?: boolean;
  /** Device Detail tach "Tu tat sau khi bat" thanh khuc rieng (khong thuoc
   * cong tac Hen gio cua card): "schedule" an chip Tu tat, "auto_off" chi sua
   * Tu tat (an ca hang chip kieu lich). Bo trong = du 3 kieu (trang Nha). */
  mode?: "schedule" | "auto_off";
  onClose: () => void;
  onSave: (draft: ScheduleDraft, id?: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [sunTimes, setSunTimes] = useState<{ sunrise: string | null; sunset: string | null }>({ sunrise: null, sunset: null });

  useEffect(() => {
    setSaveAttempted(false);
    if (schedule) {
      setDraft(draftFromSchedule(schedule, allSchedules));
    } else if (open) {
      const fresh = { ...EMPTY_DRAFT, target_entities: presetEntities ?? [] };
      setDraft(mode === "auto_off"
        ? { ...fresh, trigger_type: "auto_off", action_service: "turn_off", time: lastAutoOffDuration(allSchedules) }
        : fresh);
    }
  }, [schedule, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lay gio moc troi HOM NAY 1 lan khi mo sheet - de OffsetStepper hien
  // "~05:43" ben duoi khi chon Binh minh/Hoang hon (phan hoi 2026-09-23).
  useEffect(() => {
    if (!open) return;
    api.getSunToday().then(setSunTimes).catch(() => setSunTimes({ sunrise: null, sunset: null }));
  }, [open]);

  const nameFor = (id: string) => entities.find((e) => e.entity_id === id)?.alias || entities.find((e) => e.entity_id === id)?.ha_friendly_name || id;
  const isRange = draft.end_time !== null;
  // "Tu tat sau khi bat" (v0.5.44): `time` la do dai, backend dem tu luc
  // thiet bi thuc su bat (tu bat ky dau) - khong co ngay lap/dieu kien/hanh dong.
  const isAutoOff = draft.trigger_type === "auto_off";
  const leaveAutoOff = (d: ScheduleDraft): Partial<ScheduleDraft> =>
    d.trigger_type === "auto_off" ? { trigger_type: "time", time: EMPTY_DRAFT.time, action_service: "turn_on" } : {};
  const climateInfo = useMemo(() => mergeClimateAttrs(draft.target_entities, entities), [draft.target_entities, entities]);
  const lightInfo = useMemo(() => mergeLightAttrs(draft.target_entities, entities), [draft.target_entities, entities]);
  const coverInfo = useMemo(() => mergeCoverAttrs(draft.target_entities, entities), [draft.target_entities, entities]);
  const fanInfo = useMemo(() => mergeFanAttrs(draft.target_entities, entities), [draft.target_entities, entities]);

  const profile = useMemo(
    () => domainProfile(draft.target_entities.map((id) => entities.find((e) => e.entity_id === id)?.domain ?? id.split(".", 1)[0]), Boolean(coverInfo?.supports_position)),
    [draft.target_entities, entities, coverInfo],
  );
  const onWord = profile?.onWord ?? tr("Bật", "On");
  const offWord = profile?.offWord ?? tr("Tắt", "Off");
  const defaultClimateMode = () => (climateInfo?.hvac_modes.includes("cool") ? "cool" : climateInfo?.hvac_modes[0]) ?? "cool";
  /** Chon 1 hanh dong + gia tri mac dinh cua no (che do may lanh, 100%...). */
  const withAction = (d: ScheduleDraft, action_service: ActionService): ScheduleDraft => ({
    ...d,
    action_service,
    ...(action_service === "climate_set" ? { climate_hvac_mode: d.climate_hvac_mode ?? defaultClimateMode() } : {}),
    ...(action_service === "light_set" ? { light_brightness_pct: d.light_brightness_pct ?? 100 } : {}),
    ...(action_service === "cover_set" ? { cover_position: d.cover_position ?? 100 } : {}),
    ...(action_service === "fan_set" ? { fan_percentage: d.fan_percentage ?? 50 } : {}),
  });

  // Doi thiet bi / kieu lich ma lua chon hien tai khong con hop voi loai thiet
  // bi (vd scene khong co khung gio, rem khong co "Bat") -> ve lua chon dau
  // tien hop le, tranh ket o 1 chip khong con hien de bam doi (v0.5.79).
  useEffect(() => {
    if (!profile) return;
    setDraft((d) => {
      let next = d;
      if (next.trigger_type === "auto_off" && !profile.autoOff) next = { ...next, ...leaveAutoOff(next) };
      if (next.end_time !== null && !profile.range) next = { ...next, end_time: null };
      if (next.end_time === null && next.trigger_type !== "auto_off" && !profile.actions.includes(next.action_service)) {
        next = withAction(next, profile.actions[0]);
      }
      return next === d ? d : next;
    });
  }, [profile?.key, isRange, isAutoOff]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moi thiet bi chi 1 lich Tu tat: 2 lich thi backend chi lay thoi gian ngan
  // nhat, lich kia vo nghia (backend cung chan, xem _check_auto_off_unique).
  const autoOffTaken = useMemo(() => isAutoOff && allSchedules.some((s) => s.id !== schedule?.id
    && s.trigger_type === "auto_off" && s.target_entities.some((id) => draft.target_entities.includes(id))), [isAutoOff, allSchedules, schedule?.id, draft.target_entities]);
  const validationError = useMemo(() => validateScheduleDraft(draft)
    ?? (autoOffTaken ? tr("Thiết bị này đã có lịch Tự tắt sau khi bật - sửa lịch đó thay vì tạo thêm.", "This device already has an auto-off rule - edit it instead of adding another.") : null),
  [draft, autoOffTaken]);
  const showError = validationError && (saveAttempted || draft.target_entities.length > 0);

  // Khung gio co moc mat troi (v0.5.79): chon ket thuc trong ngay / hom sau.
  // 2 gio co dinh thi tu suy theo gio (null). Tron gio co dinh + mat troi chua
  // chon -> doan theo gio mat troi hom nay roi luu gia tri chon tay.
  const hasSun = isRange && (draft.trigger_type !== "time" || draft.end_trigger_type !== "time");
  const mixedSun = isRange && (draft.trigger_type === "time") !== (draft.end_trigger_type === "time");
  const clockOf = (trigger: string, offset: number, time: string): number | null => {
    if (trigger === "time") {
      const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
      return h * 3600 + m * 60 + s;
    }
    const iso = trigger === "sunrise" ? sunTimes.sunrise : sunTimes.sunset;
    return iso ? secondsOfDayInZone(iso) + offset * 60 : null;
  };
  const guessedOffset = (): 0 | 1 => {
    const on = clockOf(draft.trigger_type, draft.offset_minutes, draft.time);
    const off = clockOf(draft.end_trigger_type, draft.end_offset_minutes, draft.end_time ?? draft.time);
    return on !== null && off !== null && off <= on ? 1 : 0;
  };
  const effectiveDayOffset: 0 | 1 = draft.range_day_offset ?? (mixedSun
    ? guessedOffset()
    : rangeDayOffset(
        { trigger_type: draft.trigger_type, time: draft.time, offset_minutes: draft.offset_minutes, range_day_offset: null },
        { trigger_type: draft.end_trigger_type, time: draft.end_time ?? draft.time, offset_minutes: draft.end_offset_minutes, range_day_offset: null },
      ));

  function save() {
    setSaveAttempted(true);
    if (validationError) return;
    const range_day_offset = !hasSun ? null : mixedSun ? effectiveDayOffset : draft.range_day_offset;
    onSave({ ...draft, range_day_offset }, schedule?.id);
  }

  function defaultEndTime(time: string): string {
    const [hour, minute, second = 0] = time.split(":").map(Number);
    return `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }

  // Dieu kien phu (muc "chỉ chạy khi có điều kiện" 2026-09-23, kieu
  // Conditions cua HA Automation, vd "chỉ bật máy lạnh khi CB Tổng đang
  // on") - AND tat ca, kiem tra o backend ngay truoc luc dinh goi service
  // (xem scheduler_engine.py _conditions_met()). Chi chon trong cac thiet
  // bi DA THEM o Cai dat -> Thiet bi (phan hoi 2026-09-24), state chon tu
  // danh sach xo xuong theo loai thiet bi (utils/conditionStates.ts).
  // "on" = them vao dieu kien moc Bat (hoac lich 1 moc), "off" = moc Tat cua Khung gio.
  const [conditionPickerFor, setConditionPickerFor] = useState<"on" | "off" | null>(null);
  function addCondition(entityId: string, target: "on" | "off") {
    const key = target === "on" ? "conditions" : "end_conditions";
    const state = defaultConditionState(entities.find((e) => e.entity_id === entityId));
    setDraft((d) => (d[key].some((c) => c.entity_id === entityId) ? d : { ...d, [key]: [...d[key], { entity_id: entityId, state }] }));
  }

  return (
    <>
      <BottomSheet
        open={open}
        title={mode === "auto_off" ? `⏱ ${tr("Tự tắt sau khi bật", "Auto-off after on")}` : schedule ? tr("Sửa lịch", "Edit schedule") : tr("Thêm lịch", "Add schedule")}
        onClose={onClose}
        footer={
          <div className="sheet__actions">
            {schedule && onDelete && (
              <button className="btn btn--danger" onClick={() => onDelete(schedule.id)}>
                {tr("Xóa", "Delete")}
              </button>
            )}
            <button className="btn btn--ghost" onClick={onClose}>
              {tr("Hủy", "Cancel")}
            </button>
            <button className="btn btn--primary" onClick={save} disabled={Boolean(validationError)}>
              {tr("Lưu", "Save")}
            </button>
          </div>
        }
      >
        {lockEntities ? (
          <div className="input schedule-editor__entities-locked">
            {draft.target_entities.length === 0 ? tr("Chưa chọn thiết bị", "No device selected") : draft.target_entities.map(nameFor).join(", ")}
          </div>
        ) : (
          <button className="input input--button" onClick={() => setPickerOpen(true)}>
            {draft.target_entities.length === 0 ? `+ ${tr("Chọn thiết bị", "Select devices")}` : draft.target_entities.map(nameFor).join(", ")}
          </button>
        )}

        {mode !== "auto_off" && (!profile || profile.range || profile.autoOff) && <div className="chip-row">
          <button className={!isRange && !isAutoOff ? "chip chip--active" : "chip"} onClick={() => setDraft((d) => ({ ...d, end_time: null, ...leaveAutoOff(d) }))}>
            {tr("Mốc thời gian", "Time point")}
          </button>
          {(!profile || profile.range) && <button
            className={isRange ? "chip chip--active" : "chip"}
            onClick={() =>
              setDraft((d) => {
                const base = { ...d, ...leaveAutoOff(d) };
                return { ...base, end_time: d.end_time ?? defaultEndTime(base.time), action_service: "turn_on" };
              })
            }
          >
            {tr("Khung giờ", "Time range")} ({onWord} → {offWord})
          </button>}
          {mode !== "schedule" && (!profile || profile.autoOff) && <button
            className={isAutoOff ? "chip chip--active" : "chip"}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                trigger_type: "auto_off",
                end_time: null,
                action_service: "turn_off",
                time: d.trigger_type === "auto_off" ? d.time : lastAutoOffDuration(allSchedules),
                conditions: [],
                end_conditions: [],
              }))
            }
          >
            ⏱ {tr("Tự tắt sau khi bật", "Auto-off after on")}
          </button>}
        </div>}

        {/* Lich 1 moc: chon kieu gio o day. Khung gio: moi moc Bat/Tat co hang
            chip rieng ben duoi (v0.5.51). */}
        {!isAutoOff && !isRange && <div className="chip-row">
          <button
            className={draft.trigger_type === "time" ? "chip chip--active" : "chip"}
            onClick={() => setDraft((d) => ({ ...d, trigger_type: "time" }))}
          >
            {tr("Giờ cụ thể", "Specific time")}
          </button>
          <button
            className={draft.trigger_type === "sunrise" ? "chip chip--active" : "chip"}
            onClick={() => setDraft((d) => ({ ...d, trigger_type: "sunrise" }))}
          >
            🌅 {tr("Bình minh", "Sunrise")}{sunHint(sunTimes.sunrise)}
          </button>
          <button
            className={draft.trigger_type === "sunset" ? "chip chip--active" : "chip"}
            onClick={() => setDraft((d) => ({ ...d, trigger_type: "sunset" }))}
          >
            🌇 {tr("Hoàng hôn", "Sunset")}{sunHint(sunTimes.sunset)}
          </button>
        </div>}

        {showError && <div className="form-error" role="alert">{validationError}</div>}

        {isAutoOff ? (
          <>
            <div className="field-label field-label--inline">{tr("Tắt sau (giờ : phút : giây)", "Turn off after (h : m : s)")}</div>
            <TimeWheelPicker value={draft.time} onChange={(time) => setDraft((d) => ({ ...d, time }))} />
            <p className="settings-hint">
              {tr(
                "Mỗi lần thiết bị bật (từ Lovelace, công tắc tay, automation hay lịch khác) sẽ tự tắt sau khoảng này. Mốc bật được lưu lại, Home Assistant/add-on khởi động lại vẫn tính tiếp; quá hạn trong lúc tắt máy thì tắt ngay khi chạy lại.",
                "Whenever the device turns on (dashboard, wall switch, automation or another schedule) it is turned off after this duration. The on-time is stored, so restarts keep counting; if it expired while offline it turns off as soon as the add-on is back.",
              )}
            </p>
          </>
        ) : isRange ? (
          <>
          <div className="range-wheels">
            <div className="range-wheel">
              <div className="field-label field-label--inline">{onWord} {tr("lúc", "at")}</div>
              <PointEditor
                trigger={draft.trigger_type === "auto_off" ? "time" : draft.trigger_type}
                offset={draft.offset_minutes}
                time={draft.time}
                sunTimes={sunTimes}
                onChange={(trigger_type, offset_minutes, time) => setDraft((d) => ({ ...d, trigger_type, offset_minutes, time }))}
              />
            </div>
            <div className="range-swap-row">
            <button
              type="button"
              className="range-swap"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  trigger_type: d.end_trigger_type,
                  offset_minutes: d.end_offset_minutes,
                  time: d.end_time ?? d.time,
                  end_trigger_type: d.trigger_type === "auto_off" ? "time" : d.trigger_type,
                  end_offset_minutes: d.offset_minutes,
                  end_time: d.time,
                  conditions: d.end_conditions,
                  end_conditions: d.conditions,
                }))
              }
              aria-label={tr("Đổi chỗ Bật và Tắt", "Swap on and off")}
              title={tr("Đổi chỗ Bật và Tắt", "Swap on and off")}
            >
              ⇅ {tr("Đổi", "Swap")} {onWord}/{offWord}
            </button>
            </div>
            <div className="range-wheel">
              <div className="field-label field-label--inline">{offWord} {tr("lúc", "at")}</div>
              <PointEditor
                trigger={draft.end_trigger_type}
                offset={draft.end_offset_minutes}
                time={draft.end_time!}
                sunTimes={sunTimes}
                onChange={(end_trigger_type, end_offset_minutes, end_time) => setDraft((d) => ({ ...d, end_trigger_type, end_offset_minutes, end_time }))}
              />
            </div>
          </div>
            {hasSun && (
              <>
                <label className="field-label">{offWord} {tr("vào", "on")}</label>
                <div className="chip-row">
                  <button className={effectiveDayOffset === 0 ? "chip chip--active" : "chip"} onClick={() => setDraft((d) => ({ ...d, range_day_offset: 0 }))}>
                    {tr("Trong ngày", "Same day")}
                  </button>
                  <button className={effectiveDayOffset === 1 ? "chip chip--active" : "chip"} onClick={() => setDraft((d) => ({ ...d, range_day_offset: 1 }))}>
                    🌙 {tr("Sáng hôm sau", "Next day")}
                  </button>
                </div>
                <p className="settings-hint">
                  {tr(
                    "Hôm nào giờ mặt trời làm giờ kết thúc đến trước giờ bắt đầu (khung trong ngày) thì khung hôm đó được bỏ qua.",
                    "On days when sun times put the end before the start (same-day range), that day's range is skipped.",
                  )}
                </p>
              </>
            )}
            {profile?.rangeLight && (
              <>
                <label className="field-label">{tr("Khi bật", "When turning on")}</label>
                <div className="chip-row">
                  <button
                    className={!(draft.light_brightness_pct != null || draft.light_color_temp_kelvin != null || draft.light_rgb_color != null) ? "chip chip--active" : "chip"}
                    onClick={() => setDraft((d) => ({ ...d, light_brightness_pct: null, light_color_temp_kelvin: null, light_rgb_color: null }))}
                  >
                    {tr("Như lần trước", "As last time")}
                  </button>
                  <button
                    className={draft.light_brightness_pct != null || draft.light_color_temp_kelvin != null || draft.light_rgb_color != null ? "chip chip--active" : "chip"}
                    onClick={() => setDraft((d) => ({ ...d, light_brightness_pct: d.light_brightness_pct ?? 100 }))}
                  >
                    💡 {tr("Đặt độ sáng/màu", "Set brightness/color")}
                  </button>
                </div>
                {(draft.light_brightness_pct != null || draft.light_color_temp_kelvin != null || draft.light_rgb_color != null) && (
                  <LightActionEditor
                    light={lightInfo}
                    brightnessPct={draft.light_brightness_pct}
                    colorTempKelvin={draft.light_color_temp_kelvin}
                    rgbColor={draft.light_rgb_color}
                    onChange={(light_brightness_pct, light_color_temp_kelvin, light_rgb_color) =>
                      setDraft((d) => ({ ...d, light_brightness_pct, light_color_temp_kelvin, light_rgb_color }))
                    }
                  />
                )}
              </>
            )}
          </>
        ) : draft.trigger_type === "time" ? (
          <TimeWheelPicker value={draft.time} onChange={(time) => setDraft((d) => ({ ...d, time }))} />
        ) : (
          <OffsetStepper
            label={draft.trigger_type === "sunrise" ? tr("Bình minh", "Sunrise") : tr("Hoàng hôn", "Sunset")}
            minutes={draft.offset_minutes}
            baseTimeIso={draft.trigger_type === "sunrise" ? sunTimes.sunrise : sunTimes.sunset}
            onChange={(offset_minutes) => setDraft((d) => ({ ...d, offset_minutes }))}
          />
        )}

        {!isRange && !isAutoOff && (
          <>
            <label className="field-label">{tr("Hành động", "Action")}</label>
            {profile ? (
              <div className="chip-row">
                {profile.actions.map((service) => (
                  <button
                    key={service}
                    className={draft.action_service === service ? "chip chip--active" : "chip"}
                    onClick={() => setDraft((d) => withAction(d, service))}
                  >
                    {actionChipLabel(service, profile.domain)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="settings-hint">{tr("Chọn thiết bị để hiện các hành động của loại đó.", "Select devices to see their actions.")}</p>
            )}
            {draft.action_service === "climate_set" && (
              <ClimateActionEditor
                climate={climateInfo}
                mode={draft.climate_hvac_mode}
                temperature={draft.climate_temperature}
                onChange={(climate_hvac_mode, climate_temperature) => setDraft((d) => ({ ...d, climate_hvac_mode, climate_temperature }))}
              />
            )}
            {draft.action_service === "light_set" && (
              <LightActionEditor
                light={lightInfo}
                brightnessPct={draft.light_brightness_pct}
                colorTempKelvin={draft.light_color_temp_kelvin}
                rgbColor={draft.light_rgb_color}
                onChange={(light_brightness_pct, light_color_temp_kelvin, light_rgb_color) =>
                  setDraft((d) => ({ ...d, light_brightness_pct, light_color_temp_kelvin, light_rgb_color }))
                }
              />
            )}
            {draft.action_service === "cover_set" && (
              <CoverActionEditor position={draft.cover_position} onChange={(cover_position) => setDraft((d) => ({ ...d, cover_position }))} />
            )}
            {draft.action_service === "fan_set" && (
              <FanActionEditor
                fan={fanInfo}
                percentage={draft.fan_percentage}
                presetMode={draft.fan_preset_mode}
                onChange={(fan_percentage, fan_preset_mode) => setDraft((d) => ({ ...d, fan_percentage, fan_preset_mode }))}
              />
            )}
          </>
        )}

        {!isAutoOff && <>
        <label className="field-label">{tr("Ngày lặp", "Repeat days")}</label>
        <DaySelector value={draft.days} onChange={(days) => setDraft((d) => ({ ...d, days }))} />

        <label className="field-label">{tr("Khoảng ngày áp dụng", "Active date range")}</label>
        <div className="chip-row">
          <button
            className={!draft.start_date && !draft.end_date ? "chip chip--active" : "chip"}
            onClick={() => setDraft((d) => ({ ...d, start_date: null, end_date: null }))}
          >
            {tr("Luôn áp dụng", "Always")}
          </button>
          <button
            className={draft.start_date || draft.end_date ? "chip chip--active" : "chip"}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                start_date: d.start_date ?? todayInZone(),
                end_date: d.end_date ?? todayInZone(),
              }))
            }
          >
            {tr("Khoảng ngày cụ thể", "Specific dates")}
          </button>
        </div>
        {(draft.start_date || draft.end_date) && (
          <div className="date-range-fields">
            <div className="date-range-field">
              <span className="field-label field-label--inline">{tr("Từ ngày", "From")}</span>
              <input
                type="date"
                className="input"
                value={draft.start_date ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value || null }))}
              />
            </div>
            <div className="date-range-field">
              <span className="field-label field-label--inline">{tr("Đến ngày", "To")}</span>
              <input
                type="date"
                className="input"
                value={draft.end_date ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value || null }))}
              />
            </div>
          </div>
        )}

        {isRange ? (
          <>
            <ConditionList
              label={tr("Điều kiện khi BẬT (chỉ bật khi đúng hết, để trống = luôn bật)", "ON conditions (all must match; empty = always turn on)")}
              conditions={draft.conditions}
              entities={entities}
              nameFor={nameFor}
              onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
              onAdd={() => setConditionPickerFor("on")}
            />
            <ConditionList
              label={tr("Điều kiện khi TẮT (để trống = luôn tắt đúng giờ, khuyên dùng)", "OFF conditions (empty = always turn off on time, recommended)")}
              conditions={draft.end_conditions}
              entities={entities}
              nameFor={nameFor}
              onChange={(end_conditions) => setDraft((d) => ({ ...d, end_conditions }))}
              onAdd={() => setConditionPickerFor("off")}
            />
          </>
        ) : (
          <ConditionList
            label={tr("Điều kiện (chỉ chạy khi đúng hết, để trống = luôn chạy)", "Conditions (all must match; empty = always run)")}
            conditions={draft.conditions}
            entities={entities}
            nameFor={nameFor}
            onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
            onAdd={() => setConditionPickerFor("on")}
          />
        )}
        </>}
      </BottomSheet>

      <EntityPicker
        open={pickerOpen}
        selected={draft.target_entities}
        schedules={allSchedules}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setDraft((d) => {
            // Doi thiet bi ma khong con toan cung 1 domain nhu truoc -> hanh dong
            // rieng theo domain (climate_set/light_set/cover_set/fan_set) khong
            // con hop le nua, ve lai "turn_on" mac dinh.
            const requiredDomain = Object.entries(DOMAIN_ACTION_SERVICE).find(([, svc]) => svc === d.action_service)?.[0];
            const stillMatches = !requiredDomain || (ids.length > 0 && ids.every((id) => entities.find((e) => e.entity_id === id)?.domain === requiredDomain));
            return { ...d, target_entities: ids, action_service: stillMatches ? d.action_service : "turn_on" };
          });
          setPickerOpen(false);
        }}
      />

      {/* scope mac dinh "added": chi thiet bi da them trong Cai dat (xem ghi
          chu tren dinh nghia addCondition). Chi lay phan tu DAU TIEN duoc
          chon lam entity cho dieu kien moi - EntityPicker von cho chon
          nhieu, o day chi dung 1. */}
      <EntityPicker
        open={conditionPickerFor !== null}
        selected={[]}
        onClose={() => setConditionPickerFor(null)}
        onConfirm={(ids) => {
          if (ids[0] && conditionPickerFor) addCondition(ids[0], conditionPickerFor);
          setConditionPickerFor(null);
        }}
      />
    </>
  );
}
