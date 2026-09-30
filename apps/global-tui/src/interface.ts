/** Public surface of the global dashboard; each layer has one responsibility. */
export { GlobalController, validateSnapshot, type Route } from "./model.js";
export { render } from "./view.js";
export { runInteractive, runLineInterface, type KeyTerminal } from "./interaction.js";
