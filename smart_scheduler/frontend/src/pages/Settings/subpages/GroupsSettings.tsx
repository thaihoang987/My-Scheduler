import { mdiArrowDown, mdiArrowUp, mdiDeleteOutline, mdiPlus, mdiPencilOutline } from "@mdi/js";
import { useState } from "react";
import { Icon } from "../../../components/Icon/Icon";
import { api } from "../../../services/api";
import type { Group } from "../../../types";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";

/** Quan ly "Nhom" PHAN LOAI thiet bi tren trang Nha (muc "phan nhom" phan
 * hoi 2026-09-23) - tao/doi ten/xoa/doi thu tu. Thu tu doi bang nut len/
 * xuong (khong dung keo-tha o day, danh sach ngan + it thao tac, giu don
 * gian/an toan hon) - keo-tha THAT su danh cho THE THIET BI tren trang Nha
 * (xem GroupedDeviceGrid.tsx), noi thao tac keo-tha thuc su can thiet vi so
 * luong the co the nhieu va lam thuong xuyen hon nhieu so voi sua danh sach
 * nhom (hiem khi doi). */
export function GroupsSettings({
  categoryGroups,
  reloadCategoryGroups,
  onBack,
}: {
  categoryGroups: Group[];
  reloadCategoryGroups: () => void;
  onBack: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<Group | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  async function addGroup() {
    const name = newName.trim();
    if (!name) return;
    await api.createGroup(name);
    setNewName("");
    reloadCategoryGroups();
  }

  async function saveRename() {
    if (!editing || !nameDraft.trim()) return;
    await api.renameGroup(editing.id, nameDraft.trim());
    setEditing(null);
    reloadCategoryGroups();
  }

  async function removeGroup(g: Group) {
    await api.deleteGroup(g.id);
    reloadCategoryGroups();
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= categoryGroups.length) return;
    const reordered = [...categoryGroups];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await api.reorderGroups(reordered.map((g) => g.id));
    reloadCategoryGroups();
  }

  return (
    <div className="page">
      <SubpageHeader title={tr("Nhóm", "Groups")} onBack={onBack} />
      <p className="settings-hint">{tr("Phân loại thiết bị thành từng nhóm hiển thị riêng trên trang Nhà. Gán thiết bị vào nhóm ở Cài đặt → Thiết bị.", "Organize devices into separate groups on Home. Assign devices from Settings → Devices.")}</p>

      <div className="date-range-fields">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={tr("Tên nhóm mới, vd: Phòng khách", "New group name, e.g. Living room")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn--primary" onClick={addGroup} disabled={!newName.trim()}>
          <Icon path={mdiPlus} size={20} /> {tr("Thêm", "Add")}
        </button>
      </div>

      {categoryGroups.length === 0 ? (
        <div className="empty-hint">{tr("Chưa có nhóm nào.", "No groups yet.")}</div>
      ) : (
        <div className="entity-list">
          {categoryGroups.map((g, i) => (
            <div key={g.id} className="entity-row entity-row--editable">
              <div className="entity-row__info">
                <div className="entity-row__name">{g.name}</div>
              </div>
              <button className="icon-btn icon-btn--plain" onClick={() => move(i, -1)} disabled={i === 0} aria-label={tr("Lên", "Move up")}>
                <Icon path={mdiArrowUp} size={22} />
              </button>
              <button className="icon-btn icon-btn--plain" onClick={() => move(i, 1)} disabled={i === categoryGroups.length - 1} aria-label={tr("Xuống", "Move down")}>
                <Icon path={mdiArrowDown} size={22} />
              </button>
              <button
                className="icon-btn icon-btn--plain"
                onClick={() => {
                  setEditing(g);
                  setNameDraft(g.name);
                }}
                aria-label={tr("Đổi tên", "Rename")}
              >
                <Icon path={mdiPencilOutline} size={22} />
              </button>
              <button className="icon-btn icon-btn--plain" onClick={() => removeGroup(g)} aria-label={tr("Xóa nhóm", "Delete group")}>
                <Icon path={mdiDeleteOutline} size={22} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="sheet-backdrop" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            <div className="sheet__title">{tr("Đổi tên nhóm", "Rename group")}</div>
            <div className="sheet__body">
              <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
            </div>
            <div className="sheet__footer">
              <div className="sheet__actions">
                <button className="btn btn--ghost" onClick={() => setEditing(null)}>
                  {tr("Hủy", "Cancel")}
                </button>
                <button className="btn btn--primary" onClick={saveRename}>
                  {tr("Lưu", "Save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
