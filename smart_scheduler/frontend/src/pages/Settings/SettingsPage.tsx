import { useState, type ReactNode } from "react";
import { goBack, useBackNavigation } from "../../hooks/useBackNavigation";
import type { DeviceGroup, EntitySummary, Group, HealthStatus, PresenceStatus, Schedule, Settings as SettingsType } from "../../types";
import { SettingsHome, type SettingsSubpage } from "./SettingsHome";
import { AboutSettings } from "./subpages/AboutSettings";
import { AppearanceSettings } from "./subpages/AppearanceSettings";
import { BackupSettings } from "./subpages/BackupSettings";
import { DevicesSettings } from "./subpages/DevicesSettings";
import { GroupsSettings } from "./subpages/GroupsSettings";
import { LogSettings } from "./subpages/LogSettings";
import { PresenceSettings } from "./subpages/PresenceSettings";
import { SchedulerSettings } from "./subpages/SchedulerSettings";
import { StatusSettings } from "./subpages/StatusSettings";

export function SettingsPage({
  entities,
  settings,
  schedules,
  groups,
  categoryGroups,
  reloadCategoryGroups,
  haConnected,
  haConnectionMode,
  reload,
  reloadPresence,
  presence,
}: {
  entities: EntitySummary[];
  settings: SettingsType;
  schedules: Schedule[];
  groups: DeviceGroup[];
  categoryGroups: Group[];
  reloadCategoryGroups: () => void;
  haConnected: boolean;
  haConnectionMode: HealthStatus["ha_connection_mode"];
  reload: () => void;
  reloadPresence: () => void;
  presence: PresenceStatus | null;
}) {
  const [subpage, setSubpage] = useState<SettingsSubpage | null>(null);
  useBackNavigation(subpage !== null, () => setSubpage(null));
  const back = () => goBack(subpage !== null, () => setSubpage(null));

  if (subpage === null) return <SettingsHome onOpen={setSubpage} />;

  let content: ReactNode;
  switch (subpage) {
    case "devices":
      content = <DevicesSettings entities={entities} schedules={schedules} categoryGroups={categoryGroups} reload={reload} onBack={back} />;
      break;
    case "groups":
      content = <GroupsSettings categoryGroups={categoryGroups} reloadCategoryGroups={reloadCategoryGroups} onBack={back} />;
      break;
    case "appearance":
      content = <AppearanceSettings settings={settings} reload={reload} onBack={back} />;
      break;
    case "scheduler":
      content = <SchedulerSettings settings={settings} reload={reload} onBack={back} />;
      break;
    case "presence":
      content = <PresenceSettings entities={entities} liveStatus={presence} reloadPresence={reloadPresence} onBack={back} />;
      break;
    case "backup":
      content = <BackupSettings reload={reload} onBack={back} />;
      break;
    case "status":
      content = <StatusSettings schedules={schedules} groups={groups} haConnected={haConnected} haConnectionMode={haConnectionMode} onBack={back} />;
      break;
    case "log":
      content = <LogSettings onBack={back} />;
      break;
    case "about":
      content = <AboutSettings onBack={back} />;
      break;
    default:
      content = null;
  }

  return <div>{content}</div>;
}
