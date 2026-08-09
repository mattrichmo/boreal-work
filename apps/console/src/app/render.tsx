import { renderToStaticMarkup } from "react-dom/server";

import { ConsoleApp } from "./app.js";
import { consoleAppCss } from "./styles.js";
import type { ConsoleDataSet, ConsoleRenderOptions } from "./types.js";

export function renderConsoleHtml(options: ConsoleRenderOptions): string {
  const route = options.route ?? "/";
  const body = renderToStaticMarkup(<ConsoleApp routePath={route} data={options.data} />);
  const state = `<script id="boreal-console-state" class="bw-json-state" type="application/json">${escapeJsonForScript(JSON.stringify(consoleStatePayload(options.data)))}</script>`;
  const client = `<script>${consoleClientScript()}</script>`;
  if (options.includeDocument === false) {
    return `${body}${state}${client}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Boreal Console</title><style>${consoleAppCss}</style></head><body>${body}${state}${client}</body></html>`;
}

export function consoleStatePayload(data: ConsoleDataSet): unknown {
  return {
    ...data,
    routes: data.routes.map((route) => ({
      id: route.id,
      path: route.path,
      label: route.label
    }))
  };
}

function escapeJsonForScript(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function consoleClientScript(): string {
  return String.raw`(() => {
  const cardSelector = "[data-bw-board-card]";
  const columnSelector = "[data-bw-drop-column]";
  const refusalSelector = "[data-bw-board-refusal]";
  let draggedCard = null;

  document.addEventListener("dragstart", (event) => {
    if (actionsBlocked()) {
      event.preventDefault();
      focusActionSafety();
      return;
    }
    const card = closest(event.target, cardSelector);
    if (!card || card.getAttribute("draggable") !== "true") {
      return;
    }
    draggedCard = card;
    card.classList.add("bw-global-board-card--dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-boreal-work-id", card.dataset.workId || "");
      event.dataTransfer.setData("text/plain", card.dataset.workTitle || card.dataset.workId || "");
    }
  });

  document.addEventListener("dragend", () => {
    clearDropTargets();
    if (draggedCard) {
      draggedCard.classList.remove("bw-global-board-card--dragging");
    }
    draggedCard = null;
  });

  document.addEventListener("dragover", (event) => {
    const column = closest(event.target, columnSelector);
    if (!column || !draggedCard || column.dataset.bwDroppable !== "true") {
      return;
    }
    event.preventDefault();
    column.classList.add("bw-global-board-column--drop-target");
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  document.addEventListener("dragleave", (event) => {
    const column = closest(event.target, columnSelector);
    if (column && !column.contains(event.relatedTarget)) {
      column.classList.remove("bw-global-board-column--drop-target");
    }
  });

  document.addEventListener("drop", async (event) => {
    if (actionsBlocked()) {
      event.preventDefault();
      clearDropTargets();
      focusActionSafety();
      return;
    }
    const column = closest(event.target, columnSelector);
    if (!column || !draggedCard) {
      return;
    }
    event.preventDefault();
    clearDropTargets();
    await submitBoardDrop(draggedCard, column.dataset.bwDropColumn || "");
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest("[data-bw-action-scope]")) {
      return;
    }
    if (actionsBlocked()) {
      event.preventDefault();
      focusActionSafety();
      return;
    }
    const confirmation = form.querySelector("input[name=confirm][required]");
    if (confirmation instanceof HTMLInputElement && !confirmation.checked) {
      event.preventDefault();
      confirmation.focus();
      return;
    }
    if (form.dataset.bwSubmitting === "true") {
      event.preventDefault();
      return;
    }
    form.dataset.bwSubmitting = "true";
    form.setAttribute("aria-busy", "true");
    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement) {
      submitter.disabled = true;
    }
  });

  async function submitBoardDrop(card, targetColumn) {
    const commandId = commandForDrop(card.dataset.currentColumn || "", targetColumn);
    if (!commandId) {
      renderRefusal({
        code: "CONSOLE_BOARD_DROP_NOT_SUPPORTED",
        message: "That column is derived from project state and does not accept direct drops.",
        details: {
          workId: card.dataset.workId || "",
          targetColumn
        },
        recovery: [
          { command: "bwrk work show " + (card.dataset.workId || "<work-id>") + " --json" }
        ]
      });
      return;
    }

    const token = consoleToken();
    if (!token) {
      renderRefusal({
        code: "CONSOLE_SECURITY_TOKEN_MISSING",
        message: "The console command token was not found. Refresh the page before retrying."
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("consoleToken", token);
    params.set("confirm", "yes");
    params.set("workId", card.dataset.workId || "");
    params.set("projectRoot", card.dataset.projectRoot || "");
    if (commandId === "work.reserve") {
      params.set("agentId", "console");
      params.set("purpose", "Console board drag");
    }
    if (commandId === "work.close") {
      const reason = window.prompt("Close reason", "Closed from global board");
      if (!reason) {
        return;
      }
      params.set("reason", reason);
      params.set("dirtyPath", "no_repo_changes: closed from global board");
    }

    card.classList.add("bw-global-board-card--pending");
    try {
      const response = await fetch("/api/commands/" + commandId, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload && payload.ok === true) {
        window.location.reload();
        return;
      }
      renderRefusal(payload.error || payload || {
        code: "CONSOLE_COMMAND_FAILED",
        message: "The command did not complete."
      });
    } catch (error) {
      renderRefusal({
        code: "CONSOLE_NETWORK_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      card.classList.remove("bw-global-board-card--pending");
    }
  }

  function commandForDrop(currentColumn, targetColumn) {
    if (targetColumn === "in_progress") {
      return currentColumn === "ready" ? "work.reserve" : "";
    }
    if (targetColumn === "ready") {
      return currentColumn === "in_progress" ? "work.release" : "";
    }
    if (targetColumn === "closed") {
      return currentColumn !== "closed" ? "work.close" : "";
    }
    return "";
  }

  function renderRefusal(error) {
    const panel = document.querySelector(refusalSelector);
    if (!panel) {
      return;
    }
    panel.hidden = false;
    panel.setAttribute("tabindex", "-1");
    panel.setAttribute("aria-live", "assertive");
    panel.replaceChildren();

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "Command refused";
    const code = document.createElement("code");
    code.textContent = text(error && error.code, "CONSOLE_COMMAND_FAILED");
    header.append(title, code);
    panel.append(header);

    const message = document.createElement("p");
    message.textContent = text(error && error.message, "The command did not complete.");
    panel.append(message);

    const details = record(error && error.details);
    const gaps = array(details.gaps || (error && error.gaps));
    if (gaps.length > 0) {
      const list = document.createElement("div");
      list.className = "bw-global-board-refusal__list";
      for (const gap of gaps) {
        list.append(gapRow(record(gap)));
      }
      panel.append(list);
    }

    const commands = uniqueCommands([
      ...commandsFromRecovery(error && error.recovery),
      ...commandsFromRecovery(details.recovery),
      ...commandsFromGaps(gaps),
      ...commandsFromDirectives(details.agentDirectives)
    ]);
    if (commands.length > 0) {
      const commandList = document.createElement("div");
      commandList.className = "bw-global-board-refusal__commands";
      for (const command of commands) {
        const line = document.createElement("code");
        line.textContent = command;
        commandList.append(line);
      }
      panel.append(commandList);
    }
    panel.focus();
  }

  function actionsBlocked() {
    const root = document.querySelector("[data-bw-actions-blocked]");
    return root?.getAttribute("data-bw-actions-blocked") === "true";
  }

  function focusActionSafety() {
    const notice = document.querySelector("[data-bw-action-safety]");
    if (notice instanceof HTMLElement) {
      notice.focus();
    }
  }

  function gapRow(gap) {
    const row = document.createElement("article");
    row.className = "bw-global-board-refusal__gap";
    const title = document.createElement("strong");
    title.textContent = text(gap.code, "gap");
    const body = document.createElement("span");
    const data = record(gap.data);
    body.textContent = text(data.reason, text(gap.targetId, ""));
    row.append(title, body);
    return row;
  }

  function commandsFromRecovery(value) {
    if (Array.isArray(value)) {
      return value.map((item) => text(record(item).command, "")).filter(Boolean);
    }
    const recovery = record(value);
    return text(recovery.command, "") ? [text(recovery.command, "")] : [];
  }

  function commandsFromGaps(gaps) {
    return gaps.flatMap((gap) => {
      const data = record(record(gap).data);
      return [
        text(data.command, ""),
        ...array(data.recommendedCommands).map((item) => text(item, ""))
      ].filter(Boolean);
    });
  }

  function commandsFromDirectives(bundles) {
    return array(bundles).flatMap((bundle) =>
      array(record(bundle).directives).map((directive) => {
        const data = record(record(directive).data);
        return text(data.command, "") || text(data.nextCommand, "") || text(record(directive).nextCommandTemplate, "");
      }).filter(Boolean)
    );
  }

  function uniqueCommands(values) {
    return Array.from(new Set(values.filter(Boolean))).slice(0, 8);
  }

  function consoleToken() {
    const field = document.querySelector("input[name=consoleToken]");
    return field instanceof HTMLInputElement ? field.value : "";
  }

  function clearDropTargets() {
    document.querySelectorAll(columnSelector).forEach((column) => {
      column.classList.remove("bw-global-board-column--drop-target");
    });
  }

  function closest(value, selector) {
    return value instanceof Element ? value.closest(selector) : null;
  }

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }
})();`;
}
