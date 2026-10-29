export const LEGACY_DRAFT_KEY = 'molly_crash_recovery_draft';
export const PROJECT_DRAFT_PREFIX = 'molly_crash_recovery_draft:';

export function projectDraftKey(draftId) {
    return `${PROJECT_DRAFT_PREFIX}${encodeURIComponent(String(draftId))}`;
}

export function writeProjectDraft(storage, draftId, project, timestamp = Date.now()) {
    const draft = { draftId: String(draftId), timestamp, project, hasChanges: true };
    storage.setItem(projectDraftKey(draftId), JSON.stringify(draft));
    return draft;
}

export function readProjectDraft(storage, token) {
    const key = token === 'true' || token == null
        ? LEGACY_DRAFT_KEY
        : projectDraftKey(decodeURIComponentSafe(token));
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!isValidDraft(draft)) return null;
        return { key, draft, draftId: draft.draftId || draft.project.draftId || null };
    } catch (_) {
        return null;
    }
}

export function listProjectDrafts(storage) {
    const drafts = [];
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === LEGACY_DRAFT_KEY || key?.startsWith(PROJECT_DRAFT_PREFIX)) keys.push(key);
    }

    for (const key of keys) {
        try {
            const draft = JSON.parse(storage.getItem(key));
            if (!isValidDraft(draft)) continue;
            drafts.push({
                key,
                draft,
                draftId: draft.draftId || draft.project.draftId || decodeURIComponentSafe(key.slice(PROJECT_DRAFT_PREFIX.length)),
                timestamp: Number(draft.timestamp) || 0
            });
        } catch (_) {
            // A malformed recovery record is ignored and can be removed by the user.
        }
    }

    return drafts.sort((a, b) => b.timestamp - a.timestamp);
}

export function isValidDraft(draft) {
    return Boolean(draft?.project && Array.isArray(draft.project.layers));
}

function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value);
    } catch (_) {
        return value;
    }
}

