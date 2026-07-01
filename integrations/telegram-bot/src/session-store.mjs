export class SessionStore {
  constructor({ sessions = {}, proactive = {}, reminders = {}, checkins = {} } = {}) {
    this.sessions = new Map(Object.entries(sessions));
    this.proactive = { ...proactive };
    this.reminders = { sent: {}, ...reminders };
    this.checkins = { ...checkins };
  }

  persist() {
  }

  snapshot() {
    return {
      sessions: Object.fromEntries(this.sessions.entries()),
      proactive: this.proactive,
      reminders: this.reminders,
      checkins: this.checkins,
    };
  }

  get(key = "default") {
    const id = String(key || "default");
    if (!this.sessions.has(id)) this.sessions.set(id, {});
    return this.sessions.get(id);
  }

  setPendingTaskDraft(key, draft) {
    const session = this.get(key);
    delete session.pendingAction;
    delete session.pendingCheckin;
    session.pendingTaskDraft = draft;
    this.persist();
    return draft;
  }

  getPendingTaskDraft(key) {
    return this.get(key).pendingTaskDraft || null;
  }

  clearPendingTaskDraft(key) {
    const session = this.get(key);
    const draft = session.pendingTaskDraft || null;
    delete session.pendingTaskDraft;
    this.persist();
    return draft;
  }

  setPendingAction(key, action) {
    const session = this.get(key);
    delete session.pendingTaskDraft;
    delete session.pendingCheckin;
    session.pendingAction = action;
    this.persist();
    return action;
  }

  getPendingAction(key) {
    return this.get(key).pendingAction || null;
  }

  clearPendingAction(key) {
    const session = this.get(key);
    const action = session.pendingAction || null;
    delete session.pendingAction;
    this.persist();
    return action;
  }

  setPendingCheckin(key, checkin) {
    const session = this.get(key);
    delete session.pendingTaskDraft;
    delete session.pendingAction;
    session.pendingCheckin = checkin;
    this.persist();
    return checkin;
  }

  getPendingCheckin(key) {
    return this.get(key).pendingCheckin || null;
  }

  clearPendingCheckin(key) {
    const session = this.get(key);
    const checkin = session.pendingCheckin || null;
    delete session.pendingCheckin;
    this.persist();
    return checkin;
  }

  clearPending(key) {
    return {
      taskDraft: this.clearPendingTaskDraft(key),
      action: this.clearPendingAction(key),
      checkin: this.clearPendingCheckin(key),
    };
  }

  getProfile(key) {
    const session = this.get(key);
    if (!session.profile) session.profile = {};
    return session.profile;
  }

  updateProfile(key, patch) {
    const profile = this.getProfile(key);
    Object.assign(profile, patch);
    this.persist();
    return profile;
  }

  getProactiveState() {
    return this.proactive;
  }

  getReminderState() {
    return this.reminders;
  }

  getCheckinState() {
    return this.checkins;
  }
}

export const globalSessionStore = new SessionStore();
