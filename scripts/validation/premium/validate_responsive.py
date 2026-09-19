#!/usr/bin/env python3
"""Real-PTY regressions for short editor panels and live terminal geometry.

These run the real dashboard adapter and generated standalone/embedded wizard,
with the existing fake service and local release fixture. No Rust or network.
Run AFTER npm --prefix apps/tui run build:installer.
"""
from __future__ import annotations
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import struct
import tempfile
import termios
import unittest
from validate_premium import ROOT, WIZARD, NODE, INSTALLER, PtySession, release

CSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
ROW = re.compile(r'\x1b\[(\d+);1H')


def visible(session: PtySession) -> str:
    """Reconstruct the production FrameWriter's latest complete rows, not history."""
    text = bytes(session.output).decode('utf-8', 'replace').split('\x1b[2J')[-1]
    matches = list(ROW.finditer(text))
    rows: dict[int, str] = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        rows[int(match[1])] = CSI.sub('', text[match.end():end])
    return '\n'.join(rows.get(y, '') for y in range(1, max(rows, default=0) + 1))


@unittest.skipUnless(NODE, 'Node.js is required')
class ResponsivePtyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='boreal-responsive-')
        self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def args(self):
        return {'project_id': 'boreal-work', 'project_root': str(self.root/'project'),
                'database': str(self.root/'project/.boreal/boreal.sqlite'),
                'memory_root': str(self.root/'project/memory'), 'agents': ['codex'], 'memory_layout': 'child'}
    def project(self, w=190, h=12, args=None, embedded=False):
        result = self.root/'selection.json'
        command = [NODE, '-e', WIZARD.read_text()] if embedded else [NODE, str(WIZARD)]
        return PtySession([*command, 'project', json.dumps(args or self.args())], result, w, h), result
    def assert_restored(self, s):
        self.assertIn(b'\x1b[?1049l', s.output)
        self.assertIn(b'\x1b[?25h', s.output)
        self.assertEqual(termios.tcgetattr(s.fd)[3] & (termios.ECHO | termios.ICANON), s.before[3] & (termios.ECHO | termios.ICANON))
    def cancel(self, s, result=None):
        s.send(b'\x03'); self.assertEqual(s.wait(), 130, visible(s)); self.assert_restored(s)
        if result: self.assertEqual(result.read_text(), '')

    def test_dashboard_is_operable_in_editor_panels_and_narrow_splits(self):
        for w, h in [(190,12),(160,16),(120,8),(80,12),(60,10),(40,8),(32,6),(24,6)]:
            with self.subTest(size=(w,h)):
                s = PtySession([NODE, str(ROOT/'apps/tui/tests/pty-harness.mjs')], columns=w, rows=h)
                try:
                    self.assertIn('WORK QUEUE', visible(s)); self.assertNotIn('Resize to at least', visible(s))
                    s.send(b'v\x1b[F'); self.assertIn('Tasks', visible(s))
                    s.send(b'\r/terminal\r'); s.send(b'\r'); self.assertIn('INSPECTOR', visible(s))
                    s.send(b'q'); self.assertEqual(s.wait(), 0); self.assert_restored(s)
                finally: s.close()

    def test_dashboard_resizes_while_inspector_is_focused(self):
        s = PtySession([NODE, str(ROOT/'apps/tui/tests/pty-harness.mjs')], columns=190, rows=12)
        try:
            s.send(b'\r'); s.resize(40,8)
            self.assertIn('INSPECTOR', visible(s)); self.assertNotIn('WORK QUEUE', visible(s))
            s.resize(160,40); self.assertIn('WORK QUEUE', visible(s)); self.assertIn('INSPECTOR', visible(s))
            s.send(b'q'); self.assertEqual(s.wait(), 0); self.assert_restored(s)
        finally: s.close()

    def test_custom_tty_wizard_reflows_even_when_stdout_is_a_file(self):
        s, result = self.project(40,8)
        try:
            s.send(b'\r\x1b[B ')
            self.assertIn('Claude', visible(s))
            s.resize(160,40)
            self.assertIn('SETUP PLAN', visible(s)); self.assertIn('160×40', visible(s))
            self.assertRegex(visible(s), r'\[x\] Claude')
            s.resize(32,8); self.assertNotIn('SETUP PLAN', visible(s)); self.assertIn('Claude', visible(s))
            s.send(b'\r\r\x1b[F\r'); self.assertEqual(s.wait(), 0, visible(s))
            self.assertEqual(json.loads(result.read_text())['agents'], ['codex', 'claude'])
            self.assertFalse((self.root/'project').exists()); self.assert_restored(s)
        finally: s.close()

    def test_embedded_rust_invocation_at_190_by_12_is_interactive(self):
        s, result = self.project(190,12,embedded=True)
        try:
            self.assertIn('WELCOME', visible(s)); s.send(b'\r\r\r\x1b[F\r')
            self.assertEqual(s.wait(), 0, visible(s)); self.assertTrue(json.loads(result.read_text())['confirmed'])
            self.assert_restored(s)
        finally: s.close()

    def test_project_wizard_completes_at_24_by_6(self):
        s, result = self.project(24,6)
        try:
            s.send(b'\r\x1b[B \r\x1b[B \r\x1b[F\r')
            self.assertEqual(s.wait(),0,visible(s))
            self.assertEqual(json.loads(result.read_text()), {'confirmed':True,'agents':['codex','claude'],'memory_layout':'in-repo'})
            self.assert_restored(s)
        finally: s.close()

    def test_machine_installer_at_40_by_8_honours_components(self):
        archive = release(self.root); prefix = self.root/'prefix'
        s = PtySession(['sh',str(INSTALLER),'--interactive','--archive',str(archive),'--prefix',str(prefix)], columns=40, rows=8)
        try:
            s.send(b'\r\r\x1b[B \r\r\x1b[F\r')
            self.assertEqual(s.wait(),0,visible(s))
            self.assertTrue((prefix/'bin/bwrk').exists()); self.assertFalse((prefix/'lib/boreal/tui').exists())
            self.assertFalse((prefix/'.boreal').exists()); self.assert_restored(s)
        finally: s.close()

    def test_long_review_pages_without_premature_submission(self):
        args = self.args(); args['project_root'] += '/deeply-nested-workspace'*30
        s, result = self.project(32,8,args=args)
        try:
            s.send(b'\r\r\r'); self.assertIn('Enter next page', visible(s))
            s.send(b'\r'); self.assertEqual(result.read_text(),''); self.assertFalse((self.root/'project').exists())
            s.send(b'\x1b[F'); self.assertIn('preserved', visible(s))
            s.send(b'\r'); self.assertEqual(s.wait(),0); self.assertTrue(json.loads(result.read_text())['confirmed'])
        finally: s.close()

    def test_startup_zero_dimensions_recover_when_pty_becomes_available(self):
        s, result = self.project(0,0)
        try:
            self.assertIn('BOREAL', visible(s)); s.resize(40,8)
            self.assertIn('1/4 Welcome', visible(s)); s.send(b'\r'); self.assertIn('Agent tools', visible(s))
            self.cancel(s,result)
        finally: s.close()

    def test_transient_zero_resize_does_not_erase_last_valid_layout(self):
        s, result = self.project(190,16)
        try:
            s.send(b'\r'); self.assertIn('190×16', visible(s))
            s.resize(0,0); self.assertIn('190×16', visible(s)); self.assertIn('Agent tools', visible(s))
            s.resize(120,14); self.assertIn('120×14', visible(s)); self.cancel(s,result)
        finally: s.close()

    def test_resize_does_not_discard_prefix_caret_or_help(self):
        result = self.root/'machine.json'
        s = PtySession([NODE,str(WIZARD),'machine',str(self.root/'prefix'),'','0','','main','1','1','0','0'],result,190,12)
        try:
            s.send(b'\r\x15/tmp/abcd\x1b[DX'); s.resize(24,6)
            self.assertIn('/tmp/abcX▏d',visible(s)); s.send(b'\x1bOP'); self.assertIn('Help',visible(s))
            s.resize(160,40); self.assertIn('KEYBOARD',visible(s)); s.send(b'\x1b'); s.pump(.06)
            self.assertIn('/tmp/abcX▏d',visible(s)); self.cancel(s,result)
        finally: s.close()

    def test_poll_recovers_with_sigwinch_delivery_intentionally_disabled(self):
        # Test-only wrapper drops SIGWINCH handlers. Production remains unmodified.
        # Require the generated wizard using its same Node -e project invocation.
        wrapper = "const on=process.on;process.on=function(e,f){return e==='SIGWINCH'?this:on.call(this,e,f)};require("+json.dumps(str(WIZARD))+");"
        result = self.root/'poll.json'
        s = PtySession([NODE,'-e',wrapper,'project',json.dumps(self.args())], result,40,8)
        try:
            s.send(b'\r'); s.resize(160,40); s.pump(1.25)
            self.assertIn('SETUP PLAN',visible(s)); self.assertIn('160×40',visible(s))
            self.cancel(s,result)
        finally: s.close()

    def test_resize_burst_and_cancel_restore_input_mode(self):
        s,result=self.project(190,12)
        try:
            for i in range(35):
                w,h=(24,6) if i%2 else (160,40)
                fcntl.ioctl(s.fd,termios.TIOCSWINSZ,struct.pack('HHHH',h,w,0,0))
                os.kill(s.pid,signal.SIGWINCH)
            s.resize(190,12); s.send(b'\r'); self.assertIn('AGENT TOOLS',visible(s)); self.cancel(s,result)
        finally: s.close()

    @unittest.skipUnless(Path('/proc/self/fd').exists(),'Linux descriptor accounting')
    def test_public_terminal_probes_release_owned_file_descriptors(self):
        # Probe many times on the real controlling PTY; allow destroy callbacks to run.
        url=(ROOT/'apps/tui/dist/ui/terminal-size.js').as_uri()
        js="""import {probeTerminalSize} from %s;import{readdirSync}from'node:fs';
        process.stdout.write('\\x1b[1;1Hprobe test');probeTerminalSize();
        await new Promise(r=>setTimeout(r,20));const before=readdirSync('/proc/self/fd').length;
        for(let i=0;i<120;i++){const size=probeTerminalSize();if(size.width!==190||size.height!==12)throw Error('stale geometry');await new Promise(r=>setTimeout(r,1));}
        await new Promise(r=>setTimeout(r,50));const after=readdirSync('/proc/self/fd').length;
        if(after>before+1)throw Error(`fd leak ${before}->${after}`);console.log('PROBE_FDS_OK',before,after);""" % json.dumps(url)
        s=PtySession([NODE,'--input-type=module','-e',js],columns=190,rows=12)
        try:
            self.assertEqual(s.wait(),0,bytes(s.output[-1000:]));self.assertIn(b'PROBE_FDS_OK',s.output)
        finally:s.close()


if __name__=='__main__': unittest.main()
