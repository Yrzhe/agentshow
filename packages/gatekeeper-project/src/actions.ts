// What happens to a submitted write after a human decides about it.
//
// Kept apart from both the session that asked for the write and the Durable Object that stores the
// pending record, because those two are the parts that vary: the session decides what to describe,
// the gatekeeper decides where the record lives, and this file is the single answer to "and then
// what". Every branch goes through the same `ProjectContext` the session used, so an approved action
// cannot reach further than the member who asked for it could.

import { ProjectError } from "./model.js";
import type { PendingAction, ProjectContext } from "./sessions.js";

/** Carry out an approved action. */
export async function applyAction(
  context: ProjectContext,
  action: PendingAction,
): Promise<void> {
  const memberId = context.memberId;
  switch (action.kind) {
    case "createProject":
      await context.store(action.projectId).initialize(
        action.projectId, action.name, action.description,
        { memberId, displayName: action.displayName });
      await context.rememberProject(action.projectId);
      return;
    case "joinProject":
      await context.store(action.projectId).redeemInvite(
        action.secret, { memberId, displayName: action.displayName });
      await context.rememberProject(action.projectId);
      return;
    case "createInvite":
      await context.store(action.projectId).commitInvite(
        memberId, action.secret, action.role, action.expiresAt);
      return;
    case "removeMember":
      await context.store(action.projectId).removeMember(memberId, action.targetId);
      return;
    case "setDisplayName":
      await context.setDisplayName(action.displayName);
      await propagateDisplayName(context, action.displayName);
      return;
    case "writeFile":
      await context.store(action.projectId).commitWrite(memberId, action.write);
      return;
    case "moveFile":
      await context.store(action.projectId).moveFile(memberId, action.fileId, action.path);
      return;
    case "setVisibility":
      await context.store(action.projectId).setFileVisibility(
        memberId, action.fileId, action.visibility);
      return;
    case "deleteFile":
      await context.store(action.projectId).deleteFile(memberId, action.fileId);
      return;
    case "addComment":
      await context.store(action.projectId).addComment(memberId, {
        commentId: action.commentId,
        fileId: action.fileId,
        body: action.body,
        anchor: action.anchor,
        ...(action.replyTo ? { replyTo: action.replyTo } : {}),
      });
      return;
    case "resolveComment":
      await context.store(action.projectId).resolveComment(memberId, action.commentId, true);
      return;
    case "setEnvVar":
      await context.store(action.projectId).setEnvVar(
        memberId, action.name, action.value, action.description);
      return;
    case "deleteEnvVar":
      await context.store(action.projectId).deleteEnvVar(memberId, action.name);
      return;
    case "createWidget":
      await context.store(action.projectId).commitWidget(memberId, action.widget);
      return;
    case "writeWidgetFile":
      await context.store(action.projectId).commitWidgetFile(memberId, action.write);
      return;
    case "moveWidget":
      await context.store(action.projectId).moveWidget(memberId, action.widgetId, action.path);
      return;
    case "setWidgetVisibility":
      await context.store(action.projectId).setWidgetVisibility(
        memberId, action.widgetId, action.visibility);
      return;
    case "deleteWidget": {
      // The store lives in a Durable Object of its own, so deleting the widget does not reach it.
      // Emptied only once the project has agreed the widget is gone, and only then, because a
      // refusal here must not have already thrown away what the widget was keeping.
      const { deleted } = await context.store(action.projectId).deleteWidget(
        memberId, action.widgetId);
      if (deleted) await context.clearWidgetStore(action.projectId, action.widgetId);
      return;
    }
  }
}

/**
 * Let go of a rejected action.
 *
 * Only a file write leaves anything behind: its bytes go to storage when the agent asks, so that
 * the size and type in the description are the real ones rather than a promise. Nothing indexes
 * them until the write lands, so a rejected one is unreachable -- but unreachable bytes still cost
 * the deployment money, so they go now.
 */
export async function rejectAction(
  context: ProjectContext,
  action: PendingAction,
): Promise<void> {
  if (action.kind === "writeFile") await context.discardBytes(action.write.contentKey);
  if (action.kind === "writeWidgetFile") await context.discardBytes(action.write.contentKey);
}

/** Undo an applied action, for the actions whose descriptions promised it could be undone. */
export async function revertAction(
  context: ProjectContext,
  action: PendingAction,
): Promise<void> {
  const memberId = context.memberId;
  switch (action.kind) {
    case "createInvite":
      await context.store(action.projectId).revokeInvite(action.secret);
      return;
    case "setDisplayName":
      await context.setDisplayName(action.previous);
      await propagateDisplayName(context, action.previous);
      return;
    case "writeFile":
      // Only a file this write created. Replacing one is not revertable: the bytes it overwrote are
      // gone by then, and `implementsRevert` said so when the action was submitted.
      if (!action.created) {
        throw new ProjectError(
          `${action.write.path} was replaced, and the contents it replaced were not kept.`);
      }
      await context.store(action.projectId).deleteFile(memberId, action.write.fileId);
      return;
    case "moveFile":
      await context.store(action.projectId).moveFile(
        memberId, action.fileId, action.previousPath);
      return;
    case "setVisibility":
      await context.store(action.projectId).setFileVisibility(
        memberId, action.fileId, action.previous);
      return;
    case "addComment":
      await context.store(action.projectId).deleteComment(memberId, action.commentId);
      return;
    case "resolveComment":
      await context.store(action.projectId).resolveComment(memberId, action.commentId, false);
      return;
    case "setEnvVar":
      if (action.previous) {
        await context.store(action.projectId).setEnvVar(
          memberId, action.name, action.previous.value, action.previous.description);
      } else {
        await context.store(action.projectId).deleteEnvVar(memberId, action.name);
      }
      return;
    case "deleteEnvVar":
      await context.store(action.projectId).setEnvVar(
        memberId, action.name, action.previous.value, action.previous.description);
      return;
    case "createWidget": {
      const { deleted } = await context.store(action.projectId).deleteWidget(
        memberId, action.widget.widgetId);
      if (deleted) await context.clearWidgetStore(action.projectId, action.widget.widgetId);
      return;
    }
    case "writeWidgetFile":
      // Only a file this write created, for the same reason a file write is: whatever it replaced
      // is gone by now, and `implementsRevert` said as much when the action was submitted.
      if (!action.created) {
        throw new ProjectError(
          `${action.write.path} in that widget was replaced, and the contents it replaced were ` +
          `not kept.`);
      }
      await context.store(action.projectId).deleteWidgetFile(
        memberId, action.write.widgetId, action.write.path);
      return;
    case "moveWidget":
      await context.store(action.projectId).moveWidget(
        memberId, action.widgetId, action.previousPath);
      return;
    case "setWidgetVisibility":
      await context.store(action.projectId).setWidgetVisibility(
        memberId, action.widgetId, action.previous);
      return;
    case "createProject":
    case "joinProject":
    case "removeMember":
    case "deleteFile":
    case "deleteWidget":
      throw new ProjectError(`A ${action.kind} action cannot be undone automatically.`);
  }
}

/** Tell every project this account belongs to what to call it. */
async function propagateDisplayName(
  context: ProjectContext,
  displayName: string,
): Promise<void> {
  for (const projectId of await context.listProjectIds()) {
    await context.store(projectId).setDisplayName(context.memberId, displayName);
  }
}
