from fastapi import APIRouter, HTTPException, Response
from pydantic import TypeAdapter

from app import crud, homeassistant, manual_timer
from app.models import (
    ClimateAttrs,
    CoverAttrs,
    EntityAliasIn,
    EntityAliasOut,
    EntityReplaceIn,
    EntitySummary,
    FanAttrs,
    LightAttrs,
)
from app.ws import manager
from app.i18n import tr

# Bitmask cover.SUPPORT_SET_POSITION / SUPPORT_SET_TILT_POSITION (hang so on
# dinh cua HA core, khong doi qua cac ban - xem homeassistant/components/
# cover/__init__.py). Khong the import truc tiep tu HA core (add-on khong
# co dependency homeassistant), nen khai bao lai gia tri so nguyen.
COVER_SUPPORT_SET_POSITION = 4
COVER_SUPPORT_SET_TILT_POSITION = 64


def _climate_attrs(attrs: dict) -> ClimateAttrs:
    return ClimateAttrs(
        hvac_modes=attrs.get("hvac_modes") or [],
        min_temp=attrs.get("min_temp"),
        max_temp=attrs.get("max_temp"),
        temp_step=attrs.get("target_temp_step"),
        fan_modes=attrs.get("fan_modes"),
    )


def _light_attrs(attrs: dict) -> LightAttrs:
    return LightAttrs(
        supported_color_modes=attrs.get("supported_color_modes") or [],
        min_color_temp_kelvin=attrs.get("min_color_temp_kelvin"),
        max_color_temp_kelvin=attrs.get("max_color_temp_kelvin"),
        effect_list=attrs.get("effect_list"),
    )


def _cover_attrs(attrs: dict) -> CoverAttrs:
    features = attrs.get("supported_features") or 0
    return CoverAttrs(
        supports_position=bool(features & COVER_SUPPORT_SET_POSITION),
        supports_tilt_position=bool(features & COVER_SUPPORT_SET_TILT_POSITION),
    )


def _fan_attrs(attrs: dict) -> FanAttrs:
    return FanAttrs(preset_modes=attrs.get("preset_modes"))


router = APIRouter(prefix="/api/entities", tags=["entities"])

# Serialize thang bang pydantic-core (v0.5.51): nha nhieu entity -> tra hang
# nghin EntitySummary, de FastAPI tu kiem tra lai response_model + jsonable_encoder
# ton ~0.2s moi lan (poll 8s + moi lan tai lai danh sach).
_ENTITY_LIST = TypeAdapter(list[EntitySummary])


@router.get("", response_model=list[EntitySummary])
async def list_entities(scope: str = "all"):
    """scope="all" (mac dinh): MOI entity cua HA - Entity Picker "Them thiet bi"
    can du de tim (nha co the 10.000 entity). scope="added": chi thiet bi da them
    - trang Nha/Cai dat poll moi 8s chi can nhung cai nay, khoi gui vai MB."""
    return Response(content=_ENTITY_LIST.dump_json(await build_entities(scope == "added")), media_type="application/json")


async def build_entities(added_only: bool = False) -> list[EntitySummary]:
    states = await homeassistant.get_states()
    registries = await homeassistant.get_registries()
    aliases = crud.list_aliases()
    entities_reg = registries.get("entities", {})
    devices_reg = registries.get("devices", {})
    areas_reg = registries.get("areas", {})

    out = []
    for state in states:
        entity_id = state["entity_id"]
        if added_only and not aliases.get(entity_id, {}).get("added"):
            continue
        domain = entity_id.split(".", 1)[0]
        reg = entities_reg.get(entity_id, {})
        device = devices_reg.get(reg.get("device_id"), {}) if reg.get("device_id") else {}
        area_id = reg.get("area_id") or device.get("area_id")
        alias_row = aliases.get(entity_id, {})
        attrs = state.get("attributes", {})
        out.append(
            EntitySummary(
                entity_id=entity_id,
                domain=domain,
                ha_friendly_name=attrs.get("friendly_name", entity_id),
                state=state.get("state", "unknown"),
                alias=alias_row.get("alias"),
                area=areas_reg.get(area_id) if area_id else None,
                device_name=device.get("name") or alias_row.get("device_name"),
                icon=alias_row.get("icon") or attrs.get("icon"),
                favorite=bool(alias_row.get("favorite")),
                added=bool(alias_row.get("added")),
                category_id=alias_row.get("category_id"),
                climate=_climate_attrs(attrs) if domain == "climate" else None,
                light=_light_attrs(attrs) if domain == "light" else None,
                cover=_cover_attrs(attrs) if domain == "cover" else None,
                fan=_fan_attrs(attrs) if domain == "fan" else None,
            )
        )
    # Thiet bi DA THEM ma entity khong con trong HA (thay cong tac, xoa tich
    # hop...) - van tra ve (missing=True) de Cai dat -> Thiet bi con hien va
    # bam "Đổi entity" sang entity moi duoc (v0.5.27); truoc day bien mat han.
    seen = {e.entity_id for e in out}
    for entity_id, alias_row in aliases.items():
        if entity_id in seen or not alias_row.get("added"):
            continue
        out.append(
            EntitySummary(
                entity_id=entity_id,
                domain=entity_id.split(".", 1)[0],
                ha_friendly_name=alias_row.get("alias") or entity_id,
                state="unavailable",
                alias=alias_row.get("alias"),
                area=alias_row.get("area"),
                device_name=alias_row.get("device_name"),
                icon=alias_row.get("icon"),
                favorite=bool(alias_row.get("favorite")),
                added=True,
                category_id=alias_row.get("category_id"),
                missing=True,
            )
        )
    return out


@router.post("/{entity_id}/replace")
async def replace_entity(entity_id: str, payload: EntityReplaceIn):
    """Doi thiet bi sang entity khac, giu nguyen ten rieng/icon/nhom/lich/
    dieu kien/hen cuong che - xem crud.replace_entity."""
    new_id = payload.new_entity_id.strip()
    states = await homeassistant.get_states()
    if not any(s["entity_id"] == new_id for s in states):
        raise HTTPException(status_code=404, detail=tr(f"Không tìm thấy {new_id} trong Home Assistant.", f"{new_id} was not found in Home Assistant."))
    try:
        result = crud.replace_entity(entity_id, new_id, new_id.split(".", 1)[0])
    except crud.ReplaceEntityError as exc:
        old_domain = entity_id.split(".", 1)[0]
        new_domain = new_id.split(".", 1)[0]
        detail = tr(str(exc), "The new entity is the same as the current entity." if entity_id == new_id else f"Only an entity of the same type ({old_domain}) can be selected, not {new_domain}.")
        raise HTTPException(status_code=409, detail=detail) from exc
    manual_timer.replace_entity(entity_id, new_id)
    await manager.broadcast("schedule_updated", {"replaced": True})
    return {"old_entity_id": entity_id, "new_entity_id": new_id, **result}


@router.put("/{entity_id}/alias", response_model=EntityAliasOut)
async def set_alias(entity_id: str, payload: EntityAliasIn):
    domain = entity_id.split(".", 1)[0]
    return crud.upsert_alias(entity_id, domain, payload.model_dump())
