import { mdiChevronLeft, mdiChevronRight, mdiDeleteOutline, mdiPencilOutline, mdiPlus, mdiStar, mdiStarOutline } from "@mdi/js";
import { useMemo, useRef, useState } from "react";
import { EntityPicker } from "../../../components/EntityPicker/EntityPicker";
import { Icon } from "../../../components/Icon/Icon";
import { api } from "../../../services/api";
import type { EntitySummary, Group, Schedule } from "../../../types";
import { defaultVisualFor, ICON_CHOICES, iconChoiceLabel, iconPathFor, visualFor } from "../../../utils/deviceVisuals";
import { isMdiLoaded, loadAllMdi, normalizeIconKey, useMdiIcons } from "../../../utils/mdiIcons";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { backdropProps } from "../../../utils/backdrop";

/** "API /x loi 409: {"detail":"..."}" -> chi lay phan detail de hien cho nguoi dung. */
function apiErrorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const json = msg.slice(msg.indexOf("{"));
  try {
    const detail = JSON.parse(json).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // khong phai JSON - tra nguyen van
  }
  return msg;
}

/** Trang duy nhat duoc duyet toan bo entity that tu Home Assistant (domain,
 * entity_id...) - trang chu chi duoc chon trong danh sach `added` o day
 * (phan hoi 2026-09-22: "chon entities chi trong phan cai dat thoi... trang
 * chu de nguoi nha khong biet dung chon nhung thiet bi da them"). */
export function DevicesSettings({
  entities,
  schedules,
  categoryGroups,
  reload,
  onBack,
}: {
  entities: EntitySummary[];
  schedules: Schedule[];
  categoryGroups: Group[];
  /** App.reload (async) - await de chi bo cap nhat lac quan khi du lieu moi da ve. */
  reload: () => void | Promise<void>;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EntitySummary | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  // "" = dung icon mac dinh (theo ten/domain), con lai la key "mdi:..." -
  // chon trong ICON_CHOICES hoac go/dan tay bat ky icon MDI nao giong HA
  // (v0.5.26, phan hoi 2026-09-24 "cho thêm 1 ô để copy icon tuỳ ý vào").
  const [iconDraft, setIconDraft] = useState("");
  useMdiIcons();
  const iconKey = normalizeIconKey(iconDraft);
  const iconPath = iconPathFor(iconKey);
  const iconInvalid = iconKey !== "" && !iconPath && (isMdiLoaded() || !/^mdi:[a-z0-9-]+$/.test(iconKey));
  // Doi thiet bi sang entity khac (v0.5.27, phan hoi 2026-09-24 "sửa thành
  // entities khác trực tiếp search từ hassio"): chi ap dung khi bam Lưu -
  // backend chuyen ten/icon/nhom/lich/dieu kien/hen cuong che sang entity moi.
  const [replaceWith, setReplaceWith] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [groupPickerFor, setGroupPickerFor] = useState<EntitySummary | null>(null);
  /** Cac thiet bi vua them (phan hoi 2026-09-30): them xong tu mo bang Sua
   * ten/icon, them nhieu cai thi co mui ten ◀ ▶ chuyen qua lai. Rong = dang
   * sua 1 thiet bi le (bam nut but trong danh sach). */
  const [editList, setEditList] = useState<EntitySummary[]>([]);
  const [editIdx, setEditIdx] = useState(0);
  const addingRef = useRef<Promise<void>>(Promise.resolve());

  function openEdit(e: EntitySummary) {
    setEditing(e);
    setAliasDraft(e.alias || e.ha_friendly_name);
    setIconDraft(e.icon ?? "");
    setReplaceWith(null);
    setSaveError("");
  }

  function closeEdit() {
    setEditing(null);
    setEditList([]);
  }

  /** ◀ ▶: luu thay doi cua thiet bi dang sua roi chuyen sang cai ke ben. */
  async function goTo(idx: number) {
    if (idx < 0 || idx >= editList.length) return;
    const saved = await persist();
    if (!saved) return;
    const list = editList.map((e, i) => (i === editIdx ? saved : e));
    setEditList(list);
    setEditIdx(idx);
    openEdit(list[idx]);
  }

  // Cap nhat lac quan (v0.5.51 - phan hoi "delete thiet bi lag lag"): an dong /
  // doi sao NGAY khi bam, goi API + tai lai danh sach chay ngam phia sau.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [favOverride, setFavOverride] = useState<Map<string, boolean>>(new Map());
  const added = useMemo(
    () =>
      entities
        .filter((e) => e.added && !hidden.has(e.entity_id))
        .map((e) => (favOverride.has(e.entity_id) ? { ...e, favorite: favOverride.get(e.entity_id)! } : e)),
    [entities, hidden, favOverride],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return added;
    return added.filter(
      (e) => e.entity_id.toLowerCase().includes(q) || (e.alias ?? "").toLowerCase().includes(q) || e.ha_friendly_name.toLowerCase().includes(q),
    );
  }, [added, search]);

  /** Bam Luu: luu va sang thiet bi ke tiep trong danh sach vua them, het thi dong. */
  async function saveAlias() {
    if (!(await persist())) return;
    if (editIdx < editList.length - 1) {
      const next = editIdx + 1;
      setEditIdx(next);
      openEdit(editList[next]);
    } else {
      closeEdit();
    }
  }

  /** Ghi ten/icon (+ doi entity) cua thiet bi dang sua. Tra ve ban da luu, null neu loi. */
  async function persist(): Promise<EntitySummary | null> {
    if (!editing || iconInvalid || saving) return null;
    setSaveError("");
    // Lenh "them" chua xong ma da bam Luu -> doi, khong thi ten vua sua bi ghi de.
    await addingRef.current.catch(() => undefined);
    setSaving(true);
    try {
      let targetId = editing.entity_id;
      if (replaceWith && replaceWith !== editing.entity_id) {
        await api.replaceEntity(editing.entity_id, replaceWith);
        targetId = replaceWith;
      }
      await api.setAlias(targetId, {
        alias: aliasDraft,
        // Doi entity: bo qua area cu (khu vuc cua entity moi lay tu HA).
        area: replaceWith ? undefined : editing.area,
        icon: iconKey,
        favorite: editing.favorite,
        added: true,
      });
      reload();
      return { ...editing, entity_id: targetId, alias: aliasDraft, icon: iconKey };
    } catch (err) {
      setSaveError(apiErrorDetail(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(e: EntitySummary) {
    setFavOverride((m) => new Map(m).set(e.entity_id, !e.favorite));
    try {
      await api.setAlias(e.entity_id, { alias: e.alias, area: e.area, icon: e.icon, favorite: !e.favorite, added: true });
      await reload();
    } finally {
      setFavOverride((m) => {
        const next = new Map(m);
        next.delete(e.entity_id);
        return next;
      });
    }
  }

  async function removeDevice(e: EntitySummary) {
    setHidden((h) => new Set(h).add(e.entity_id));
    try {
      await api.setAlias(e.entity_id, { alias: e.alias, area: e.area, icon: e.icon, favorite: e.favorite, added: false });
      await reload();
    } finally {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(e.entity_id);
        return next;
      });
    }
  }

  /** `picked` lay tu Entity Picker (danh sach DAY DU cua HA) - `entities` cua
   * App chi con thiet bi da them (v0.5.51). Luu song song, mo bang Sua ngay. */
  async function addDevices(entityIds: string[], picked: EntitySummary[]) {
    const byId = new Map(picked.map((e) => [e.entity_id, e]));
    const fresh = picked.filter((e) => !e.added).map((e) => ({ ...e, added: true }));
    setAddOpen(false);
    if (fresh.length) {
      setEditList(fresh);
      setEditIdx(0);
      openEdit(fresh[0]);
    }
    addingRef.current = Promise.all(
      entityIds.map((id) => {
        const e = byId.get(id);
        return api.setAlias(id, { alias: e?.alias || e?.ha_friendly_name, area: e?.area, icon: e?.icon, favorite: e?.favorite, added: true });
      }),
    ).then(() => undefined);
    await addingRef.current;
    reload();
  }

  // category_id gui "" (khong phai bo qua) de XOA khoi nhom hien tai - xem
  // ghi chu trong models.py backend.
  async function setGroup(e: EntitySummary, categoryId: string | null) {
    await api.setAlias(e.entity_id, { category_id: categoryId ?? "" });
    setGroupPickerFor(null);
    reload();
  }

  const groupNameOf = (id: string | null) => (id ? categoryGroups.find((g) => g.id === id)?.name : null);

  return (
    <div className="page">
      <SubpageHeader title={tr("Thiết bị", "Devices")} onBack={onBack} />
      <button className="btn btn--primary btn--block" onClick={() => setAddOpen(true)}>
        <Icon path={mdiPlus} size={20} /> {tr("Thêm thiết bị", "Add devices")}
      </button>
      <input className="input search-input" placeholder={`🔍 ${tr("Tìm thiết bị đã thêm...", "Search added devices...")}`} value={search} onChange={(e) => setSearch(e.target.value)} />
      {added.length === 0 ? (
        <div className="empty-hint">{tr("Chưa thêm thiết bị nào. Bấm Thêm thiết bị để bắt đầu.", "No devices added. Select Add devices to begin.")}</div>
      ) : (
        <div className="entity-list">
          {filtered.map((e) => {
            const visual = visualFor(e.domain, e.alias || e.ha_friendly_name, e.icon);
            return (
              <div key={e.entity_id} className="entity-row entity-row--editable device-row">
                <span className="entity-row__icon" style={{ "--accent": visual.color } as React.CSSProperties}>
                  <Icon path={visual.icon} size={24} />
                </span>
                {/* Ten + entity_id chiem tron chieu ngang, hang nut nho gon
                    nam ben duoi can trai - phan hoi 2026-09-24 (anh chup:
                    nut to day ten thiet bi xuong 4-5 dong). */}
                <div className="entity-row__info">
                  <div className="entity-row__name">{e.alias || e.ha_friendly_name}</div>
                  <div className="entity-row__id">
                    {e.entity_id}
                    {e.missing && <span className="entity-row__missing"> · {tr("không còn trong HA", "no longer in HA")}</span>}
                  </div>
                  <div className="device-row__actions">
                    <button className="device-row__btn device-row__btn--icon" onClick={() => toggleFavorite(e)} aria-label={tr("Yêu thích", "Favorite")}>
                      <Icon path={e.favorite ? mdiStar : mdiStarOutline} size={20} />
                    </button>
                    <button className="device-row__btn" onClick={() => setGroupPickerFor(e)}>
                      {groupNameOf(e.category_id) ?? `+ ${tr("Nhóm", "Group")}`}
                    </button>
                    <button
                      className="device-row__btn device-row__btn--icon"
                      aria-label={tr("Sửa tên và icon", "Edit name and icon")}
                      title={tr("Sửa tên và icon", "Edit name and icon")}
                      onClick={() => {
                        setEditList([]);
                        openEdit(e);
                      }}
                    >
                      <Icon path={mdiPencilOutline} size={20} />
                    </button>
                    <button className="device-row__btn device-row__btn--icon" onClick={() => removeDevice(e)} aria-label={tr("Bỏ khỏi danh sách", "Remove from list")}>
                      <Icon path={mdiDeleteOutline} size={20} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="sheet-backdrop" {...backdropProps(closeEdit)}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            {editList.length > 1 ? (
              <div className="sheet__title edit-nav">
                <button className="edit-nav__btn" onClick={() => goTo(editIdx - 1)} disabled={editIdx === 0 || saving} aria-label={tr("Thiết bị trước", "Previous device")}>
                  <Icon path={mdiChevronLeft} size={26} />
                </button>
                <span>
                  {tr("Sửa thiết bị", "Edit device")} <span className="device-section__count">{editIdx + 1}/{editList.length}</span>
                </span>
                <button className="edit-nav__btn" onClick={() => goTo(editIdx + 1)} disabled={editIdx === editList.length - 1 || saving} aria-label={tr("Thiết bị sau", "Next device")}>
                  <Icon path={mdiChevronRight} size={26} />
                </button>
              </div>
            ) : (
              <div className="sheet__title">{tr("Sửa thiết bị", "Edit device")}</div>
            )}
            <div className="sheet__body">
              <label className="field-label">{tr("Tên Home Assistant", "Home Assistant name")}</label>
              <div className="readonly-value">
                {(replaceWith && entities.find((x) => x.entity_id === replaceWith)?.ha_friendly_name) || editing.ha_friendly_name}
              </div>
              <label className="field-label">{tr("Tên riêng", "Custom name")}</label>
              <input className="input" value={aliasDraft} onChange={(e) => setAliasDraft(e.target.value)} />
              <label className="field-label">{tr("Icon hiển thị trên card hẹn giờ", "Icon displayed on the schedule card")}</label>
              {(() => {
                const def = defaultVisualFor(editing.domain, aliasDraft || editing.ha_friendly_name);
                return (
                  <div className="icon-choices" role="radiogroup" style={{ "--accent": def.color } as React.CSSProperties}>
                    <button
                      type="button"
                      className={`icon-choice ${iconKey === "" ? "icon-choice--active" : ""}`}
                      onClick={() => setIconDraft("")}
                      title={tr("Mặc định", "Default")}
                      aria-label={tr("Mặc định", "Default")}
                    >
                      <Icon path={def.icon} size={22} />
                      <span className="icon-choice__label">{tr("Mặc định", "Default")}</span>
                    </button>
                    {ICON_CHOICES.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`icon-choice ${iconKey === c.key ? "icon-choice--active" : ""}`}
                        onClick={() => setIconDraft(c.key)}
                        title={iconChoiceLabel(c)}
                        aria-label={iconChoiceLabel(c)}
                      >
                        <Icon path={c.path} size={22} />
                      </button>
                    ))}
                  </div>
                );
              })()}
              <label className="field-label">{tr("Hoặc dán tên icon bất kỳ (giống Home Assistant)", "Or paste any icon name (as in Home Assistant)")}</label>
              <div className="icon-custom">
                <span
                  className="icon-custom__preview"
                  style={{ "--accent": defaultVisualFor(editing.domain, aliasDraft || editing.ha_friendly_name).color } as React.CSSProperties}
                >
                  {iconPath ? <Icon path={iconPath} size={22} /> : <span className="icon-custom__q">?</span>}
                </span>
                <input
                  className="input"
                  placeholder="mdi:water-pump"
                  value={iconDraft}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onFocus={() => void loadAllMdi()}
                  onChange={(e) => setIconDraft(e.target.value)}
                />
              </div>
              <div className={`icon-custom__hint ${iconInvalid ? "icon-custom__hint--error" : ""}`}>
                {iconInvalid ? (
                  <>{tr(`Không tìm thấy icon "${iconKey}".`, `Icon "${iconKey}" was not found.`)}</>
                ) : iconKey && !iconPath ? (
                  <>{tr("Đang tải thư viện icon...", "Loading icon library...")}</>
                ) : (
                  <>
                    {tr("Tìm tên icon ở", "Find icon names at")}{" "}
                    <a href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noreferrer">
                      pictogrammers.com
                    </a>{" "}
                    {tr("rồi dán vào, ví dụ", "and paste one here, for example")} <code>mdi:water-pump</code>. {tr("Để trống = mặc định.", "Leave blank for the default.")}
                  </>
                )}
              </div>
              <label className="field-label">Entity ID</label>
              <div className="entity-swap">
                <div className="entity-swap__ids">
                  <div className={`readonly-value readonly-value--muted ${replaceWith ? "entity-swap__old" : ""}`}>
                    {editing.entity_id}
                    {editing.missing && <span className="entity-row__missing"> · {tr("không còn trong HA", "no longer in HA")}</span>}
                  </div>
                  {replaceWith && <div className="readonly-value entity-swap__new">→ {replaceWith}</div>}
                </div>
                {replaceWith ? (
                  <button type="button" className="btn btn--ghost" onClick={() => setReplaceWith(null)}>
                    {tr("Hoàn tác", "Undo")}
                  </button>
                ) : (
                  <button type="button" className="btn btn--ghost" onClick={() => setReplaceOpen(true)}>
                    {tr("Đổi entity", "Change entity")}
                  </button>
                )}
              </div>
              {replaceWith && (
                <div className="settings-hint">
                  {tr("Khi bấm Lưu: tên riêng, icon, nhóm, mọi lịch hẹn giờ và điều kiện đang dùng", "When saved, the custom name, icon, group, schedules, and conditions using")} <code>{editing.entity_id}</code> {tr("sẽ chuyển sang", "will move to")} <code>{replaceWith}</code>.
                </div>
              )}
              {saveError && <div className="icon-custom__hint icon-custom__hint--error">{saveError}</div>}
            </div>
            <div className="sheet__footer">
              <div className="sheet__actions">
                <button className="btn btn--ghost" onClick={closeEdit}>
                  {tr("Hủy", "Cancel")}
                </button>
                <button className="btn btn--primary" onClick={saveAlias} disabled={iconInvalid || saving}>
                  {saving ? tr("Đang lưu...", "Saving...") : editIdx < editList.length - 1 ? tr("Lưu & tiếp →", "Save & next →") : tr("Lưu", "Save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EntityPicker
        open={replaceOpen}
        single
        title={tr("Đổi sang entity khác", "Switch to another entity")}
        exclude={editing ? [editing.entity_id] : []}
        onlyDomain={editing?.domain}
        selected={[]}
        scope="all"
        schedules={schedules}
        onClose={() => setReplaceOpen(false)}
        onConfirm={(ids) => {
          if (ids[0] && ids[0] !== editing?.entity_id) setReplaceWith(ids[0]);
          setReplaceOpen(false);
        }}
      />

      <EntityPicker open={addOpen} selected={[]} scope="all" schedules={schedules} onClose={() => setAddOpen(false)} onConfirm={addDevices} />

      {groupPickerFor && (
        <div className="sheet-backdrop" {...backdropProps(() => setGroupPickerFor(null))}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            <div className="sheet__title">{tr(`Chọn nhóm cho "${groupPickerFor.alias || groupPickerFor.ha_friendly_name}"`, `Select a group for "${groupPickerFor.alias || groupPickerFor.ha_friendly_name}"`)}</div>
            <div className="sheet__body">
              <div className="entity-list">
                <button className={`entity-row entity-row--editable ${!groupPickerFor.category_id ? "chip--active" : ""}`} onClick={() => setGroup(groupPickerFor, null)}>
                  {tr("Chưa phân nhóm", "Ungrouped")}
                </button>
                {categoryGroups.map((g) => (
                  <button
                    key={g.id}
                    className={`entity-row entity-row--editable ${groupPickerFor.category_id === g.id ? "chip--active" : ""}`}
                    onClick={() => setGroup(groupPickerFor, g.id)}
                  >
                    {g.name}
                  </button>
                ))}
                {categoryGroups.length === 0 && <div className="empty-hint">{tr("Chưa có nhóm nào - vào Cài đặt → Nhóm để tạo trước.", "No groups yet. Go to Settings → Groups to create one.")}</div>}
              </div>
            </div>
            <div className="sheet__footer">
              <div className="sheet__actions">
                <button className="btn btn--ghost" onClick={() => setGroupPickerFor(null)}>
                  {tr("Đóng", "Close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
