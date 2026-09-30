import { mdiStar, mdiStarOutline } from "@mdi/js";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import type { EntitySummary, Schedule } from "../../types";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { Icon } from "../Icon/Icon";
import { tr } from "../../i18n";

const DOMAIN_FILTERS = ["Tất cả", "switch", "light", "climate", "fan", "cover", "input_boolean", "script", "scene"];
const USED_MAX = 8;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // bo dau tieng Viet de fuzzy search khong dau (muc 23 SPEC_UI.md)
}

/** React.memo + toggle nhan entity_id thay vi closure rieng (Home co the co
 * hang tram entity that - da gap lag thuc te 2026-09-22 khi list dai, moi
 * lan tick 1 checkbox lam toan bo list re-render lai vi Set `picked` doi
 * tham chieu). Memo giup chi dong dang bi tick/bo tick tu render lai. */
const EntityRow = memo(function EntityRow({
  entity,
  checked,
  showId,
  disabled,
  onToggle,
}: {
  entity: EntitySummary;
  checked: boolean;
  showId: boolean;
  disabled: boolean;
  onToggle: (entityId: string) => void;
}) {
  useMdiIcons();
  const visual = visualFor(entity.domain, entity.alias || entity.ha_friendly_name, entity.icon);
  return (
    <label className={`entity-row entity-row--card ${disabled ? "entity-row--disabled" : ""}`}>
      <span className="entity-row__icon" style={{ "--accent": visual.color } as React.CSSProperties}>
        <Icon path={visual.icon} size={22} />
      </span>
      <span className="entity-row__info">
        <span className="entity-row__name">{entity.alias || entity.ha_friendly_name}</span>
        {showId && <span className="entity-row__id">{entity.entity_id}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(entity.entity_id)} />
    </label>
  );
});

export function EntityPicker({
  open,
  selected,
  scope = "added",
  schedules = [],
  single = false,
  title,
  exclude,
  onlyDomain,
  onClose,
  onConfirm,
}: {
  open: boolean;
  selected: string[];
  /** "added" (mac dinh) - chi cho chon trong danh sach thiet bi da them o
   * Cai dat -> Thiet bi, an bo loc domain/entity_id, danh cho trang chu de
   * nguoi nha khong ranh HA dung (phan hoi 2026-09-22). "all" - duyet toan
   * bo entity that tu HA, chi dung trong Cai dat -> Thiet bi luc "+ Them
   * thiet bi". */
  scope?: "all" | "added";
  /** Toan bo schedule hien co - dung de tinh muc "Da dung" (thiet bi DANG CO
   * it nhat 1 lich, khong phai "gan day tung mo picker" - bug thuc te
   * 2026-09-23: truoc day "Da dung" la lich su chon trong picker luu o
   * localStorage, hien du entity da tung duoc chon roi huy/xoa lich van con
   * nam trong danh sach, gay hieu lam "sao thiet bi nay chua dat lich ma van
   * o Da dung"). Bo qua neu khong truyen (vd Settings->Thiet bi chua can). */
  schedules?: Schedule[];
  /** Chi chon DUNG 1 entity, khong khoa domain - dung cho "Đổi entity" trong
   * Cai dat -> Thiet bi -> Sua (v0.5.27): bam dong khac la thay luon. */
  single?: boolean;
  title?: string;
  /** entity_id khong hien trong danh sach (vd chinh entity dang duoc doi). */
  exclude?: string[];
  /** Chi hien entity DUNG domain nay, an bo loc loai - "Đổi entity" bat buoc
   * cung chung loai (phan hoi 2026-09-24, khac loai lam sai timer card). */
  onlyDomain?: string;
  onClose: () => void;
  onConfirm: (entityIds: string[]) => void;
}) {
  const displayTitle = title ?? tr("Chọn thiết bị", "Select devices");
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("Tất cả");
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(selected));
    setSearch("");
    setDomain("Tất cả");
    setLoading(true);
    api
      .listEntities()
      // Bo entity da mat khoi HA (missing, v0.5.27) - chon vao cung khong
      // dieu khien duoc - va entity bi loai tru (exclude).
      .then((list) =>
        setEntities(
          list.filter((e) => !e.missing && !exclude?.includes(e.entity_id) && (!onlyDomain || e.domain === onlyDomain)),
        ),
      )
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Thiet bi dang co it nhat 1 lich (bat ke enabled/disabled) - dinh nghia
  // dung cua "Da dung" theo phan hoi 2026-09-23.
  const usedEntityIds = useMemo(() => new Set(schedules.flatMap((s) => s.target_entities)), [schedules]);

  const byId = useMemo(() => new Map(entities.map((e) => [e.entity_id, e])), [entities]);
  // Khoa domain: 1 lich chi duoc chua thiet bi CUNG 1 domain (phan hoi
  // 2026-09-23: "không được thêm chung các thiết bị khác chủng loại vào 1
  // timer") - hanh dong rieng theo domain (climate/light/cover/fan tu
  // v0.4.7-0.4.8) gia dinh TAT CA target_entities cung domain, tron domain
  // se lam sai hoac im lang rot ve hanh dong chung khong dung y. Domain khoa
  // theo thiet bi DAU TIEN da chon (thu tu Set giu dung thu tu them vao).
  const pickedDomain = useMemo(() => {
    // scope "all" = Cai dat -> Them thiet bi: chi them vao danh sach, khong
    // tao lich, nen them cung luc nhieu loai thiet bi thoai mai (v0.5.50).
    if (single || scope === "all") return null;
    const firstId = [...picked][0];
    return firstId ? (byId.get(firstId)?.domain ?? null) : null;
  }, [picked, byId, single, scope]);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return entities.filter((e) => {
      if (scope === "added" && !e.added) return false;
      if (domain !== "Tất cả" && e.domain !== domain) return false;
      if (!q) return true;
      const haystack = normalize(`${e.entity_id} ${e.alias ?? ""} ${e.ha_friendly_name} ${e.area ?? ""} ${e.domain}`);
      return q.split(/\s+/).every((term) => haystack.includes(term));
    });
  }, [entities, search, domain, scope]);

  const showSuggestions = !search.trim() && domain === "Tất cả";
  const scoped = useMemo(() => (scope === "added" ? entities.filter((e) => e.added) : entities), [entities, scope]);
  const favorites = useMemo(() => (showSuggestions ? scoped.filter((e) => e.favorite) : []), [showSuggestions, scoped]);
  const used = useMemo(
    () => (showSuggestions ? scoped.filter((e) => !e.favorite && usedEntityIds.has(e.entity_id)).slice(0, USED_MAX) : []),
    [showSuggestions, scoped, usedEntityIds],
  );

  // Danh sach nhom theo khu vuc KHONG lap lai entity da hien o Yeu thich/Gan
  // day o tren - phan hoi 2026-09-22: 2 khoi bi trung y het nhau khi thiet
  // bi chua co khu vuc (roi ca vao "Chua gan khu vuc" giong het "Gan day").
  const grouped = useMemo(() => {
    const shownAbove = new Set([...favorites, ...used].map((e) => e.entity_id));
    const groups = new Map<string, EntitySummary[]>();
    for (const e of filtered) {
      if (shownAbove.has(e.entity_id)) continue;
      const key = e.area || tr("Chưa gán khu vực", "No area assigned");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return groups;
  }, [filtered, favorites, used]);

  const toggle = useCallback(
    (entityId: string) => {
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(entityId)) {
          next.delete(entityId);
          return next;
        }
        if (single) return new Set([entityId]);
        // Chan chon khac domain voi thiet bi da chon (xem pickedDomain o
        // tren) - phong truong hop goi toggle() truc tiep bo qua thuoc tinh
        // `disabled` cua checkbox (vd ban phim/test tu dong).
        const entityDomain = byId.get(entityId)?.domain;
        if (next.size > 0 && pickedDomain && entityDomain !== pickedDomain) return prev;
        next.add(entityId);
        return next;
      });
    },
    [byId, pickedDomain, single],
  );

  function confirm() {
    onConfirm([...picked]);
  }

  return (
    <BottomSheet
      open={open}
      title={displayTitle}
      onClose={onClose}
      footer={
        <div className="sheet__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            {tr("Hủy", "Cancel")}
          </button>
          <button className="btn btn--primary" onClick={confirm} disabled={single && picked.size === 0}>
            {single ? tr("Chọn", "Select") : `${tr("Lưu", "Save")} (${picked.size})`}
          </button>
        </div>
      }
    >
      <input
        className="input search-input"
        placeholder={`🔍 ${tr("Tìm thiết bị...", "Search devices...")}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {onlyDomain && <div className="settings-hint">{tr(`Chỉ hiện thiết bị cùng loại (${onlyDomain}) để lịch hẹn giờ không bị sai.`, `Only ${onlyDomain} devices are shown to keep the schedule valid.`)}</div>}
      {scope === "all" && !onlyDomain && (
        <div className="chip-row">
          {DOMAIN_FILTERS.map((d) => (
            <button key={d} className={domain === d ? "chip chip--active" : "chip"} onClick={() => setDomain(d)}>
              {d === "Tất cả" ? tr("Tất cả", "All") : d}
            </button>
          ))}
        </div>
      )}
      {loading && <div className="empty-hint">{tr("Đang tải danh sách thiết bị từ Home Assistant...", "Loading devices from Home Assistant...")}</div>}
      {!loading && scope === "added" && scoped.length === 0 && (
        <div className="empty-hint">
          {tr("Chưa có thiết bị nào được thêm.", "No devices have been added.")}
          <br />
          {tr("Vào Cài đặt → Thiết bị để thêm trước.", "Go to Settings → Devices to add one first.")}
        </div>
      )}
      {!loading && scoped.length > 0 && filtered.length === 0 && <div className="empty-hint">{tr("Không tìm thấy thiết bị nào.", "No devices found.")}</div>}

      {pickedDomain && (
        <div className="settings-hint">{tr(`Lịch chỉ chứa được thiết bị cùng loại (${pickedDomain}) — bỏ chọn hết để đổi sang loại khác.`, `A schedule can only contain devices of the same type (${pickedDomain}). Clear the selection to choose another type.`)}</div>
      )}

      {showSuggestions && favorites.length > 0 && (
        <div className="entity-group">
          <div className="entity-group__title">
            <Icon path={mdiStar} size={14} /> {tr("Yêu thích", "Favorites")}
          </div>
          {favorites.map((e) => (
            <EntityRow
              key={e.entity_id}
              entity={e}
              checked={picked.has(e.entity_id)}
              showId={scope === "all"}
              disabled={Boolean(pickedDomain) && e.domain !== pickedDomain && !picked.has(e.entity_id)}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
      {showSuggestions && used.length > 0 && (
        <div className="entity-group">
          <div className="entity-group__title">{tr("Đã dùng", "In use")}</div>
          {used.map((e) => (
            <EntityRow
              key={e.entity_id}
              entity={e}
              checked={picked.has(e.entity_id)}
              showId={scope === "all"}
              disabled={Boolean(pickedDomain) && e.domain !== pickedDomain && !picked.has(e.entity_id)}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      <div className="entity-list">
        {[...grouped.entries()].map(([area, items]) => (
          <div key={area} className="entity-group">
            <div className="entity-group__title">{area}</div>
            {items.map((e) => (
              <EntityRow
                key={e.entity_id}
                entity={e}
                checked={picked.has(e.entity_id)}
                showId={scope === "all"}
                disabled={Boolean(pickedDomain) && e.domain !== pickedDomain && !picked.has(e.entity_id)}
                onToggle={toggle}
              />
            ))}
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

export { EntityRow };
