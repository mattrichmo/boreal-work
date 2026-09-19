#!/usr/bin/env python3
"""Offline installer fixtures and real POSIX PTYs. No production installation or network.

Run from any directory: python3 scripts/validation/premium/validate_premium.py -v
Requires Node 20–26, compiled apps/tui/dist, /dev/tty, tar and a POSIX host.
The fake executable and controller deliberately isolate presentation from Rust.
"""
from __future__ import annotations
import contextlib
import fcntl
import io
import json
import os
from pathlib import Path
import pty
import platform
import select
import shutil
import signal
import struct
import subprocess
import tarfile
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
INSTALLER = ROOT / 'install.sh'
WIZARD = ROOT / 'apps/tui/installer/wizard.cjs'
NODE = shutil.which('node')
_machine = 'aarch64' if platform.machine() in {'arm64', 'aarch64'} else 'x86_64'
_target = _machine + ('-apple-darwin' if platform.system() == 'Darwin' else '-unknown-linux-gnu')
ARCHIVE_NAME = 'bwrk-v0.2.0-' + _target


def release(folder: Path, token: str = 'fixture', bad_link: bool = False) -> Path:
    """Create the real release directory shape, not a downloaded production binary."""
    source = folder / ('source-' + token) / ARCHIVE_NAME
    data = {
        'bin/bwrk': f'#!/bin/sh\nprintf "%s\\n" "bwrk {token}"\n',
        'lib/boreal/tui/entrypoint.js': f'// fixture {token}\n',
        'share/boreal/release.json': json.dumps({'version':'0.2.0','fixture':token}),
        'share/boreal/LICENSE': token,
        'share/boreal/install.sh': '#!/bin/sh\n# updater ' + token,
    }
    for name, text in data.items():
        target=source/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
    (source/'bin/bwrk').chmod(0o755)
    output=folder/token/ (ARCHIVE_NAME+'.tar.gz');output.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(output,'w:gz') as tar:
        tar.add(source,arcname=ARCHIVE_NAME)
        if bad_link:
            info=tarfile.TarInfo(ARCHIVE_NAME+'/lib/boreal/escape');info.type=tarfile.SYMTYPE;info.linkname='/tmp'
            tar.addfile(info)
    return output


def run_install(archive: Path, prefix: Path, *flags: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(['sh',str(INSTALLER),'--yes','--archive',str(archive),'--prefix',str(prefix),*flags],
        cwd=ROOT,env={**os.environ,'TERM':'xterm-256color',**(env or {})},text=True,capture_output=True,timeout=15)


def installed_bytes(prefix: Path) -> dict[str,bytes]:
    return {str(path.relative_to(prefix)):path.read_bytes() for path in prefix.rglob('*') if path.is_file() and not path.name.startswith('.bwrk')}


class PtySession:
    def __init__(self, argv: list[str], stdout_file: Path | None = None, columns: int = 100, rows: int = 36):
        self.pid,self.fd=pty.fork()
        if self.pid==0:
            try:
                fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
                os.environ['TERM']='xterm-256color';os.environ.pop('CI',None)
                if stdout_file:
                    fd=os.open(stdout_file,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
                    os.dup2(fd,1);os.close(fd)
                os.chdir(ROOT);os.execvpe(argv[0],argv,os.environ)
            except BaseException:
                os._exit(127)
        self.output=bytearray();self.status=None
        self.before=termios.tcgetattr(self.fd)
        try:
            self.read_until(b'\x1b[1;1H',timeout=5)
        except BaseException:
            self.close()
            raise

    def pump(self, seconds: float = .08) -> None:
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            ready,_,_=select.select([self.fd],[],[],max(0,deadline-time.monotonic()))
            if not ready:break
            try:
                chunk=os.read(self.fd,65536)
            except OSError:break
            if not chunk:break
            self.output.extend(chunk)

    def read_until(self, value: bytes, timeout: float = 5) -> None:
        deadline=time.monotonic()+timeout
        while value not in self.output and time.monotonic()<deadline:self.pump(.05)
        if value not in self.output:
            raise AssertionError(f'PTY never rendered {value!r}: {bytes(self.output[-1000:])!r}')

    def send(self, keys: bytes) -> None:
        os.write(self.fd,keys);self.pump(.12)

    def resize(self, columns: int, rows: int) -> None:
        fcntl.ioctl(self.fd,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
        os.kill(self.pid,signal.SIGWINCH);self.pump(.12)

    def wait(self) -> int:
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            self.pump(.05)
            pid,status=os.waitpid(self.pid,os.WNOHANG)
            if pid:
                self.status=os.waitstatus_to_exitcode(status)
                return self.status
        os.kill(self.pid,signal.SIGKILL);os.waitpid(self.pid,0)
        raise AssertionError('PTY child failed to exit')

    def close(self) -> None:
        if self.status is None:
            with contextlib.suppress(ProcessLookupError):os.kill(self.pid,signal.SIGKILL)
            with contextlib.suppress(ChildProcessError):os.waitpid(self.pid,0)
        os.close(self.fd)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='boreal-validation-');self.root=Path(self.temp.name)
        self.prefix=self.root/'prefix';self.archive=release(self.root)
    def tearDown(self):self.temp.cleanup()
    def assert_success(self,result):self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)

    def test_install_and_reinstall_without_prompts(self):
        self.assert_success(run_install(self.archive,self.prefix))
        result=run_install(self.archive,self.prefix);self.assert_success(result)
        self.assertNotIn('\x1b',result.stdout);self.assertTrue((self.prefix/'lib/boreal/tui/entrypoint.js').exists())
        self.assertFalse((self.prefix/'.bwrk-install.lock').exists());self.assertFalse((self.prefix/'.boreal').exists())

    def test_cli_only_removes_only_the_previously_installed_dashboard(self):
        self.assert_success(run_install(self.archive,self.prefix))
        self.assert_success(run_install(self.archive,self.prefix,'--no-dashboard'))
        self.assertFalse((self.prefix/'lib/boreal/tui').exists());self.assertTrue((self.prefix/'bin/bwrk').exists())

    def test_legacy_binary_is_preserved_without_explicit_permission(self):
        (self.prefix/'bin').mkdir(parents=True);old=self.prefix/'bin/bwrk';old.write_text('legacy v1')
        result=run_install(self.archive,self.prefix);self.assertNotEqual(result.returncode,0);self.assertEqual(old.read_text(),'legacy v1')
        self.assertIn('separate --prefix',result.stderr)
        self.assert_success(run_install(self.archive,self.prefix,'--replace-existing'))

    def test_symlink_archive_is_rejected_before_extraction(self):
        bad=release(self.root,'symlink',bad_link=True);result=run_install(bad,self.prefix)
        self.assertNotEqual(result.returncode,0);self.assertIn('no links',result.stderr);self.assertFalse(self.prefix.exists())

    def test_parent_traversal_member_is_rejected(self):
        bad=self.root/'evil'/self.archive.name;bad.parent.mkdir()
        with tarfile.open(bad,'w:gz') as tar:
            payload=b'evil';info=tarfile.TarInfo(ARCHIVE_NAME+'/../outside');info.size=len(payload);tar.addfile(info,io.BytesIO(payload))
        result=run_install(bad,self.prefix);self.assertNotEqual(result.returncode,0);self.assertFalse(self.prefix.exists())

    def test_lock_blocks_concurrent_publish_without_touching_current_install(self):
        self.assert_success(run_install(self.archive,self.prefix));before=installed_bytes(self.prefix)
        (self.prefix/'.bwrk-install.lock').mkdir();result=run_install(self.archive,self.prefix)
        self.assertNotEqual(result.returncode,0);self.assertEqual(installed_bytes(self.prefix),before)
        self.assertTrue((self.prefix/'.bwrk-install.lock').exists())

    def test_failure_during_second_backup_restores_first_and_preserves_unmoved_files(self):
        self.assert_success(run_install(self.archive,self.prefix));before=installed_bytes(self.prefix)
        new=release(self.root,'upgrade');shim=self.root/'shim';shim.mkdir();mv=shutil.which('mv');once=self.root/'failed-once'
        (shim/'mv').write_text(f'#!/bin/sh\nif [ "$1" = "{self.prefix}/lib/boreal/tui" ] && [ ! -f "{once}" ]; then : > "{once}"; exit 71; fi\nexec "{mv}" "$@"\n')
        (shim/'mv').chmod(0o755)
        result=run_install(new,self.prefix,env={'PATH':str(shim)+':'+os.environ['PATH']})
        self.assertNotEqual(result.returncode,0);self.assertEqual(installed_bytes(self.prefix),before)
        self.assertFalse(list(self.prefix.glob('.bwrk-backup.*')))

    def test_signal_after_backup_rename_restores_original_without_a_marker_gap(self):
        self.assert_success(run_install(self.archive,self.prefix));before=installed_bytes(self.prefix)
        shim=self.root/'signal-shim';shim.mkdir();mv=shutil.which('mv');once=self.root/'signal-once'
        (shim/'mv').write_text(f'#!/bin/sh\nif [ "$1" = "{self.prefix}/bin/bwrk" ] && [ ! -f "{once}" ]; then : > "{once}"; "{mv}" "$@" || exit $?; kill -TERM "$PPID"; exit 0; fi\nexec "{mv}" "$@"\n')
        (shim/'mv').chmod(0o755)
        result=run_install(release(self.root,'signalled'),self.prefix,env={'PATH':str(shim)+':'+os.environ['PATH']})
        self.assertNotEqual(result.returncode,0);self.assertEqual(installed_bytes(self.prefix),before)

    def test_invalid_prefix_fails_before_installation(self):
        for prefix in ['relative','/','/tmp/..','//','/./']:
            result=run_install(self.archive,Path(prefix));self.assertNotEqual(result.returncode,0)

    def test_interactive_machine_flow_installs_selected_components(self):
        session=PtySession(['sh',str(INSTALLER),'--interactive','--archive',str(self.archive),'--prefix',str(self.prefix)])
        try:
            session.send(b'\r\r\x1b[B \r\r\r') # welcome, prefix, disable dashboard, source, review
            self.assertEqual(session.wait(),0,bytes(session.output[-2000:]))
            self.assertTrue((self.prefix/'bin/bwrk').exists());self.assertFalse((self.prefix/'lib/boreal/tui').exists())
            self.assertIn(b'\x1b[?1049l',session.output)
        finally:session.close()


@unittest.skipUnless(NODE,'Node.js is required')
class TerminalTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory(prefix='boreal-pty-');self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def project_args(self):
        return {'project_id':'boreal-work','project_root':str(self.root/'project'),'database':str(self.root/'project/.boreal/boreal.sqlite'),'memory_root':str(self.root/'project/memory'),'agents':['codex'],'memory_layout':'child'}

    def test_project_wizard_returns_multiselect_json_without_creating_project(self):
        result=self.root/'result.json';session=PtySession([NODE,str(WIZARD),'project',json.dumps(self.project_args())],result)
        try:
            session.send(b'\r\x1b[B \r\x1b[B \r\r');self.assertEqual(session.wait(),0,bytes(session.output[-2000:]))
            self.assertEqual(json.loads(result.read_text()),{'confirmed':True,'agents':['codex','claude'],'memory_layout':'in-repo'})
            self.assertFalse((self.root/'project').exists());self.assertIn(b'\x1b[?2004l',session.output)
        finally:session.close()

    def test_embedded_rust_invocation_shape_executes_same_project_wizard(self):
        result=self.root/'embedded.json';session=PtySession([NODE,'-e',WIZARD.read_text(),'project',json.dumps(self.project_args())],result)
        try:
            session.send(b'\r\r\r\r');self.assertEqual(session.wait(),0,bytes(session.output[-2000:]))
            self.assertEqual(json.loads(result.read_text())['agents'],['codex'])
        finally:session.close()

    def test_project_wizard_cancel_restores_terminal_and_emits_no_selection(self):
        result=self.root/'cancel.json';session=PtySession([NODE,str(WIZARD),'project',json.dumps(self.project_args())],result)
        try:
            session.send(b'\x03');self.assertEqual(session.wait(),130);self.assertEqual(result.read_text(),'')
            self.assertIn(b'\x1b[?25h',session.output);self.assertIn(b'\x1b[?1049l',session.output)
        finally:session.close()

    def test_dashboard_narrow_resize_search_palette_and_quit(self):
        session=PtySession([NODE,str(ROOT/'apps/tui/tests/pty-harness.mjs')],columns=132,rows=40)
        try:
            session.send(b'p');session.read_until(b'COMMAND PALETTE');session.send(b'\x1b');session.pump(.06)
            session.resize(80,24);session.send(b'/installer\r');session.send(b'\r');session.read_until(b'INSPECTOR')
            session.send(b'q');self.assertEqual(session.wait(),0);self.assertIn(b'BOREAL_PTY_RESTORED',session.output)
            after=termios.tcgetattr(session.fd)
            self.assertEqual(after[3] & (termios.ECHO|termios.ICANON),self.before_flags(session))
        finally:session.close()

    @staticmethod
    def before_flags(session):return session.before[3] & (termios.ECHO|termios.ICANON)

    def test_dashboard_signal_restores_terminal(self):
        session=PtySession([NODE,str(ROOT/'apps/tui/tests/pty-harness.mjs')])
        try:
            os.kill(session.pid,signal.SIGTERM);self.assertEqual(session.wait(),0);self.assertIn(b'\x1b[?1049l',session.output)
        finally:session.close()


if __name__=='__main__':unittest.main()
