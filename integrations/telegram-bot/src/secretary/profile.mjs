export function parseSleepHours(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!match) return null;
  const startHour = Math.max(0, Math.min(23, Number.parseInt(match[1], 10)));
  const endHour = Math.max(0, Math.min(23, Number.parseInt(match[2], 10)));
  return { startHour, endHour };
}

export function applyProfileToConfig(config, profile = {}) {
  if (!profile.sleepHours && !profile.checkinHours) return config;
  return {
    ...config,
    telegram: {
      ...config.telegram,
      quietHours: profile.sleepHours || config.telegram.quietHours,
      checkinHours: profile.checkinHours || config.telegram.checkinHours,
    },
  };
}

export function parseProjectRoute(text) {
  const match = String(text || "").trim().match(/^([^=:]+)\s*[=:]\s*([^\s|]+)(?:\|(.+))?$/);
  if (!match) return null;
  const keyword = match[1].trim().toLowerCase();
  const projectId = match[2].trim();
  const projectName = (match[3] || "").trim();
  if (!keyword || !projectId) return null;
  return { keyword, projectId, projectName };
}

export function effectiveProjectRoutes(profile = {}, config) {
  return [
    ...(profile.projectRoutes || []),
    ...(config.telegram.projectRoutes || []),
  ];
}

export function formatProjectRoutes(profile = {}, config) {
  const routes = effectiveProjectRoutes(profile, config);
  if (!routes.length) return "Project routes\nNo project routing rules.";
  return [
    "Project routes",
    ...routes.map((route) => {
      const label = route.projectName ? `${route.projectId} (${route.projectName})` : route.projectId;
      return `- ${route.keyword} -> ${label}`;
    }),
  ].join("\n");
}

export function formatProfile(profile = {}, config) {
  const sleep = profile.sleepHours || config.telegram.quietHours;
  const checkins = profile.checkinHours || config.telegram.checkinHours;
  const reminderLeadMinutes = profile.reminderLeadMinutes || config.telegram.reminderLeadMinutes;
  const routes = effectiveProjectRoutes(profile, config);
  const lines = [
    "Secretary profile",
    `sleep/quiet hours: ${sleep.startHour}-${sleep.endHour}`,
    `check-in hours: ${checkins.startHour}-${checkins.endHour}`,
    `reminder lead: ${reminderLeadMinutes}m`,
    `timezone: ${config.telegram.defaultTimezone}`,
    `project routes: ${routes.length}`,
  ];
  if (profile.defaultProjectName) lines.push(`default project: ${profile.defaultProjectName}`);
  return lines.join("\n");
}

export function updateSleepProfile(session, key, text) {
  const sleepHours = parseSleepHours(text);
  if (!sleepHours) {
    return {
      ok: false,
      text: "Usage: /set-sleep 23-8",
    };
  }
  const profile = session.updateProfile(key, { sleepHours });
  return {
    ok: true,
    profile,
    text: `Sleep/quiet hours saved: ${sleepHours.startHour}-${sleepHours.endHour}`,
  };
}

export function updateCheckinProfile(session, key, text) {
  const checkinHours = parseSleepHours(text);
  if (!checkinHours) {
    return {
      ok: false,
      text: "Usage: /set-checkins 9-21",
    };
  }
  const profile = session.updateProfile(key, { checkinHours });
  return {
    ok: true,
    profile,
    text: `Check-in hours saved: ${checkinHours.startHour}-${checkinHours.endHour}`,
  };
}

export function updateProjectRouteProfile(session, key, text) {
  const route = parseProjectRoute(text);
  if (!route) {
    return {
      ok: false,
      text: "Usage: /set-route keyword=projectId or /set-route keyword=projectId|Project Name",
    };
  }
  const profile = session.getProfile(key);
  const routes = (profile.projectRoutes || []).filter((existing) => existing.keyword !== route.keyword);
  routes.unshift(route);
  session.updateProfile(key, { projectRoutes: routes });
  return {
    ok: true,
    profile,
    text: `Project route saved: ${route.keyword} -> ${route.projectId}`,
  };
}

export function updateReminderLeadProfile(session, key, text) {
  const minutes = Number.parseInt(String(text || "").trim(), 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    return {
      ok: false,
      text: "Usage: /set-reminder-lead 30",
    };
  }
  const profile = session.updateProfile(key, { reminderLeadMinutes: minutes });
  return {
    ok: true,
    profile,
    text: `Reminder lead saved: ${minutes}m`,
  };
}
