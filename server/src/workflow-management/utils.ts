import { Action, ActionType, TagName } from "../types";

/**
 * A helper function to get the best selector for the specific user action.
 * @param action The user action.
 * @returns {string|null}
 * @category WorkflowManagement-Selectors
 */
export const getBestSelectorForAction = (action: Action) => {
  switch (action.type) {
    case ActionType.Click:
    case ActionType.Hover:
    case ActionType.DragAndDrop: {
      const selectors = action.selectors;
      // less than 25 characters, and element only has text inside
      const textSelector =
        selectors?.text?.length != null &&
          selectors?.text?.length < 25 &&
          action.hasOnlyText
          ? selectors.generalSelector
          : null;

      if (action.tagName === TagName.Input) {
        return (
          selectors.testIdSelector ??
          selectors?.id ??
          selectors?.formSelector ??
          selectors?.accessibilitySelector ??
          selectors?.generalSelector ??
          selectors?.attrSelector ??
          null
        );
      }
      if (action.tagName === TagName.A) {
        return (
          selectors.testIdSelector ??
          selectors?.id ??
          selectors?.hrefSelector ??
          selectors?.accessibilitySelector ??
          selectors?.generalSelector ??
          selectors?.attrSelector ??
          null
        );
      }

      // Prefer text selectors for spans, ems over general selectors
      if (
        action.tagName === TagName.Span ||
        action.tagName === TagName.EM ||
        action.tagName === TagName.Cite ||
        action.tagName === TagName.B ||
        action.tagName === TagName.Strong
      ) {
        return (
          selectors.testIdSelector ??
          selectors?.id ??
          selectors?.accessibilitySelector ??
          selectors?.hrefSelector ??
          textSelector ??
          selectors?.generalSelector ??
          selectors?.attrSelector ??
          null
        );
      }
      return (
        selectors.testIdSelector ??
        selectors?.id ??
        selectors?.accessibilitySelector ??
        selectors?.hrefSelector ??
        selectors?.generalSelector ??
        selectors?.attrSelector ??
        null
      );
    }
    case ActionType.Input:
    case ActionType.Keydown: {
      const selectors = action.selectors;
      return (
        selectors.testIdSelector ??
        selectors?.id ??
        selectors?.formSelector ??
        selectors?.accessibilitySelector ??
        selectors?.generalSelector ??
        selectors?.attrSelector ??
        null
      );
    }
    default:
      break;
  }
  return null;
}