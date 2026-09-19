/** Buffered UTF-8/CSI parser. Unknown escape sequences are swallowed, not typed. */
const CSI: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "shift-tab", "1~": "home", "4~": "end", "7~": "home", "8~": "end", "3~": "delete", "5~": "page-up", "6~": "page-down" };
export class StreamingKeyDecoder {
    private decoder = new TextDecoder();
    private pending = "";
    private pasting = false;
    private pasted = "";
    private controlString = false;
    get awaitingEscape(): boolean { return this.pending.startsWith("\x1b") && !this.pasting; }
    push(value: string | Uint8Array): string[] {
        this.pending += typeof value === "string" ? value : this.decoder.decode(value, { stream: true });
        return this.parse(false);
    }
    flush(): string[] { this.pending += this.decoder.decode(); return this.parse(true); }
    flushEscape(): string[] { return this.parse(true); }
    private parse(flush: boolean): string[] {
        const result: string[] = [];
        while (this.pending) {
            if (this.controlString) {
                const interrupt = this.pending.indexOf("\x03");
                if (interrupt >= 0) {
                    this.controlString = false;
                    this.pending = this.pending.slice(interrupt + 1);
                    result.push("ctrl-c");
                    continue;
                }
                const end = /\x07|\x1b\\/.exec(this.pending);
                if (!end) {
                    this.pending = this.pending.endsWith("\x1b") ? "\x1b" : "";
                    break;
                }
                this.pending = this.pending.slice(end.index + end[0].length);
                this.controlString = false;
                continue;
            }
            if (this.pasting) {
                const end = this.pending.indexOf("\x1b[201~");
                if (end < 0) {
                    // Retain a possible partial terminator. Bound clipboard memory.
                    const take = Math.max(0, this.pending.length - 6);
                    this.pasted = (this.pasted + this.pending.slice(0, take)).slice(0, 262144);
                    this.pending = this.pending.slice(take);
                    break;
                }
                this.pasted = (this.pasted + this.pending.slice(0, end)).slice(0, 262144);
                result.push("paste:" + this.pasted);
                this.pending = this.pending.slice(end + 6);
                this.pasting = false;
                this.pasted = "";
                continue;
            }
            if (this.pending.startsWith("\x1b[200~")) {
                this.pending = this.pending.slice(6);
                this.pasting = true;
                continue;
            }
            if (this.pending[0] === "\x1b") {
                if (this.pending.length === 1) {
                    if (!flush)
                        break;
                    result.push("escape");
                    this.pending = "";
                    break;
                }
                if (["]", "P", "^", "_"].includes(this.pending[1])) {
                    this.controlString = true;
                    this.pending = this.pending.slice(2);
                    continue;
                }
                if (this.pending[1] === "[" || this.pending[1] === "O") {
                    const match = /^\x1b(?:\[|O)([0-?]*[ -/]*[@-~])/.exec(this.pending);
                    if (!match) {
                        if (flush || this.pending.length > 128)
                            this.pending = "";
                        break;
                    }
                    const key = CSI[match[1]];
                    if (key)
                        result.push(key);
                    this.pending = this.pending.slice(match[0].length);
                    continue;
                }
                // Drop an unknown Alt-key chord as a unit; never let it trigger a mutation.
                this.pending = this.pending.slice(2);
                continue;
            }
            const code = this.pending.codePointAt(0)!;
            const value = String.fromCodePoint(code);
            this.pending = this.pending.slice(value.length);
            if (code === 13 || code === 10)
                result.push("enter");
            else if (code === 3)
                result.push("ctrl-c");
            else if (code === 4)
                result.push("ctrl-d");
            else if (code === 9)
                result.push("tab");
            else if (code === 11)
                result.push("ctrl-k");
            else if (code === 21)
                result.push("ctrl-u");
            else if (code === 127 || code === 8)
                result.push("backspace");
            else if (code >= 32 && !(code >= 0x7f && code <= 0x9f))
                result.push(value);
        }
        return result;
    }
}
export function decodeKeys(value: string): string[] { const decoder = new StreamingKeyDecoder(); return [...decoder.push(value), ...decoder.flush()]; }
