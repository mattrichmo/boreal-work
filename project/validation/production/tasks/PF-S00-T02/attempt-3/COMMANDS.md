# PF-S00-T02 attempt 3 command log

Each probe was bounded with timeout 20s. Historical archive claims are not treated as current results.

## python3 version
- command: `python3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## node version
- command: `node --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## npm version
- command: `npm --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## npx tsc version
- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## tsc direct version
- command: `tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## cargo version
- command: `cargo --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## rustc version
- command: `rustc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## rustfmt version
- command: `rustfmt --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## git version
- command: `git --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## zsh version
- command: `zsh --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## tar version
- command: `tar --version | sed -n "1p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## sqlite3 version
- command: `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

## command availability
- command: `for x in python3 node npm npx tsc cargo rustc rustfmt git zsh tar sqlite3; do if command -v "$x" >/dev/null 2>&1; then printf "%s=%s\\n" "$x" "$(command -v "$x")"; else printf "%s=MISSING\\n" "$x"; fi; done`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:19-06:00
- exit_status: 127
- classification: missing
- relevant_output:
```text
run_probe:5: command not found: timeout
```

Probes complete.

# Corrected bounded probes (the first wrapper was unavailable)

## python3 version corrected
- command: `python3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## node version corrected
- command: `node --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## npm version corrected
- command: `npm --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## npx tsc version corrected
- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## tsc direct version corrected
- command: `tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## cargo version corrected
- command: `cargo --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## rustc version corrected
- command: `rustc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## rustfmt version corrected
- command: `rustfmt --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## git version corrected
- command: `git --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## zsh version corrected
- command: `zsh --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## tar version corrected
- command: `tar --version | sed -n "1p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## sqlite3 version corrected
- command: `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```

## command availability corrected
- command: `for x in python3 node npm npx tsc cargo rustc rustfmt git zsh tar sqlite3 perl; do if command -v "$x" >/dev/null 2>&1; then printf "%s=%s\\n" "$x" "$(command -v "$x")"; else printf "%s=MISSING\\n" "$x"; fi; done`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:40-06:00
- exit_status: 9
- classification: fail
- relevant_output:
```text
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
panic: locale.c: 4486: Could not change LC_CTYPE locale to C.UTF-8, errno=9
```


# Corrected bounded probes with C locale

## python3 version final
- command: `python3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Python 3.14.3
```

## node version final
- command: `node --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:58-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
v26.8.2
```

## npm version final
- command: `npm --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:58-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
11.7.0
```

## npx tsc version final
- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:58-06:00
- exit_status: 142
- classification: fail
- relevant_output:
```text
```

## tsc direct version final
- command: `tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Version 5.4.5
```

## cargo version final
- command: `cargo --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
cargo 1.85.0
```

## rustc version final
- command: `rustc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
```

## rustfmt version final
- command: `rustfmt --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustfmt 1.8.0
```

## git version final
- command: `git --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
git version 2.47.0
```

## zsh version final
- command: `zsh --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
zsh 5.9 (arm64-apple-darwin24.0)
```

## tar version final
- command: `tar --version | sed -n "1p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
bsdtar 3.5.3 - libarchive 3.5.3 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8 
```

## sqlite3 version final
- command: `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
3.43.2 2023-10-10 13:08:14 1b37c146ee9ebb7acd0160c0ab1fd11017a419fa8a3187386ed8cb32b709aapl (64-bit)
```

## command availability final
- command: `for x in python3 node npm npx tsc cargo rustc rustfmt git zsh tar sqlite3 perl; do if command -v "$x" >/dev/null 2>&1; then printf "%s=%s\\n" "$x" "$(command -v "$x")"; else printf "%s=MISSING\\n" "$x"; fi; done`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:18-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
python3=/opt/homebrew/bin/python3
node=/opt/homebrew/bin/node
npm=/Users/cybertron/.npm-global/bin/npm
npx=/Users/cybertron/.npm-global/bin/npx
tsc=/Users/cybertron/.npm-global/bin/tsc
cargo=/opt/homebrew/bin/cargo
rustc=/opt/homebrew/bin/rustc
rustfmt=/opt/homebrew/bin/rustfmt
git=/opt/homebrew/bin/git
zsh=/bin/zsh
tar=/usr/bin/tar
sqlite3=/usr/bin/sqlite3
perl=/usr/bin/perl
```

# Direct probes (authoritative for availability)

## direct command availability
- command: `for x in python3 node npm npx tsc cargo rustc rustfmt git zsh tar sqlite3 perl; do command -v "$x" || true; done`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
/opt/homebrew/bin/python3
/opt/homebrew/bin/node
/Users/cybertron/.npm-global/bin/npm
/Users/cybertron/.npm-global/bin/npx
/Users/cybertron/.npm-global/bin/tsc
/opt/homebrew/bin/cargo
/opt/homebrew/bin/rustc
/opt/homebrew/bin/rustfmt
/opt/homebrew/bin/git
/bin/zsh
/usr/bin/tar
/usr/bin/sqlite3
/usr/bin/perl
```

## direct python3 version
- command: `python3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Python 3.14.3
```

## direct node version
- command: `node --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
v26.8.2
```

## direct npm version
- command: `npm --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
11.7.0
```

## direct npx tsc probe interrupted by operator bound
- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: terminated after approximately 30s by validation worker
- classification: timeout
- relevant_output: No output before termination; this does not classify npx or tsc as missing.

## direct command availability retry
- command: `for x in python3 node npm npx tsc cargo rustc rustfmt git zsh tar sqlite3 perl; do printf "%s=" "$x"; command -v "$x" || printf "MISSING\\n"; done`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
python3=/opt/homebrew/bin/python3
node=/opt/homebrew/bin/node
npm=/Users/cybertron/.npm-global/bin/npm
npx=/Users/cybertron/.npm-global/bin/npx
tsc=/Users/cybertron/.npm-global/bin/tsc
cargo=/opt/homebrew/bin/cargo
rustc=/opt/homebrew/bin/rustc
rustfmt=/opt/homebrew/bin/rustfmt
git=/opt/homebrew/bin/git
zsh=/bin/zsh
tar=/usr/bin/tar
sqlite3=/usr/bin/sqlite3
perl=/usr/bin/perl
```

## direct python3 version retry
- command: `python3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Python 3.14.3
```

## direct node version retry
- command: `node --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
v26.8.2
```

## direct npm version retry
- command: `npm --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
11.7.0
```

## direct tsc version retry
- command: `tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Version 5.4.5
```

## direct cargo version retry
- command: `cargo --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
cargo 1.85.0
```

## direct rustc version retry
- command: `rustc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
```

## direct rustfmt version retry
- command: `rustfmt --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustfmt 1.8.0
```

## direct git version retry
- command: `git --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
git version 2.47.0
```

## direct zsh version retry
- command: `zsh --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
zsh 5.9 (arm64-apple-darwin24.0)
```

## direct tar version retry
- command: `tar --version | sed -n "1p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
bsdtar 3.5.3 - libarchive 3.5.3 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8 
```

## direct sqlite3 version retry
- command: `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
3.43.2 2023-10-10 13:08:14 1b37c146ee9ebb7acd0160c0ab1fd11017a419fa8a3187386ed8cb32b709aapl (64-bit)
```

## sqlite3 compile options retry
- command: `sqlite3 :memory: "pragma compile_options;"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
ATOMIC_INTRINSICS=1
BUG_COMPATIBLE_20160819
CCCRYPT256
COMPILER=clang-16.0.0
DEFAULT_AUTOVACUUM
DEFAULT_CACHE_SIZE=2000
DEFAULT_CKPTFULLFSYNC
DEFAULT_FILE_FORMAT=4
DEFAULT_JOURNAL_SIZE_LIMIT=32768
DEFAULT_LOOKASIDE=1200,102
DEFAULT_MEMSTATUS=0
DEFAULT_MMAP_SIZE=0
DEFAULT_PAGE_SIZE=4096
DEFAULT_PCACHE_INITSZ=20
DEFAULT_RECURSIVE_TRIGGERS
DEFAULT_SECTOR_SIZE=4096
DEFAULT_SYNCHRONOUS=2
DEFAULT_WAL_AUTOCHECKPOINT=1000
DEFAULT_WAL_SYNCHRONOUS=1
DEFAULT_WORKER_THREADS=0
DQS=3
ENABLE_API_ARMOR
ENABLE_BYTECODE_VTAB
ENABLE_COLUMN_METADATA
ENABLE_DBPAGE_VTAB
ENABLE_DBSTAT_VTAB
ENABLE_EXPLAIN_COMMENTS
ENABLE_FTS3
ENABLE_FTS3_PARENTHESIS
ENABLE_FTS3_TOKENIZER
ENABLE_FTS4
ENABLE_FTS5
ENABLE_LOCKING_STYLE=1
ENABLE_MATH_FUNCTIONS
ENABLE_NORMALIZE
ENABLE_PREUPDATE_HOOK
ENABLE_RTREE
ENABLE_SESSION
ENABLE_SNAPSHOT
ENABLE_SQLLOG
ENABLE_STMT_SCANSTATUS
ENABLE_UNKNOWN_SQL_FUNCTION
ENABLE_UPDATE_DELETE_LIMIT
HAS_CODEC_RESTRICTED
HAVE_ISNAN
MALLOC_SOFT_LIMIT=1024
MAX_ATTACHED=10
MAX_COLUMN=2000
MAX_COMPOUND_SELECT=500
MAX_DEFAULT_PAGE_SIZE=8192
MAX_EXPR_DEPTH=1000
MAX_FUNCTION_ARG=127
MAX_LENGTH=2147483645
MAX_LIKE_PATTERN_LENGTH=50000
MAX_MMAP_SIZE=1073741824
MAX_PAGE_COUNT=1073741823
MAX_PAGE_SIZE=65536
MAX_SQL_LENGTH=1000000000
MAX_TRIGGER_DEPTH=1000
MAX_VARIABLE_NUMBER=500000
MAX_VDBE_OP=250000000
MAX_WORKER_THREADS=8
MUTEX_UNFAIR
OMIT_AUTORESET
OMIT_LOAD_EXTENSION
STMTJRNL_SPILL=131072
SYSTEM_MALLOC
TEMP_STORE=1
THREADSAFE=2
USE_URI
```

## python sqlite runtime retry
- command: `python3 -c "import sqlite3; print(sqlite3.sqlite_version); print(sqlite3.version)"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 1
- classification: fail
- relevant_output:
```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import sqlite3; print(sqlite3.sqlite_version); print(sqlite3.version)
                                                         ^^^^^^^^^^^^^^^
AttributeError: module 'sqlite3' has no attribute 'version'
3.53.4
```

## unix socket disposable path retry
- command: `p=/tmp/boreal-pf-s00-t02-3.sock; rm -f "$p"; python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); print(\"bound\",sys.argv[1]); s.close()" "$p"; rc=$?; rm -f "$p"; exit $rc`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 1
- classification: fail
- relevant_output:
```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); print("bound",sys.argv[1]); s.close()
                                                        ~~~~~~^^^^^^^^^^^^^
PermissionError: [Errno 1] Operation not permitted
```

## git status current dirty tree retry
- command: `git status --short --branch`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
## codex/apply-responsive-terminal-overlay...origin/codex/apply-responsive-terminal-overlay [ahead 1]
 M MASTER_PLAN.md
 M apps/tui/src/client.ts
 M apps/tui/src/ui/dashboard.ts
 M crates/application/src/lib.rs
 M crates/application/src/status.rs
 M crates/application/tests/boundary_remediation.rs
 M crates/application/tests/p2_guided_flow.rs
 M crates/application/tests/work_model_v3.rs
 M crates/cli/src/main.rs
 M crates/cli/src/service.rs
 M crates/cli/src/update.rs
 M crates/cli/tests/command_registry.rs
 M crates/cli/tests/project_setup.rs
 M crates/cli/tests/service_signal_recovery.rs
 M crates/domain/src/lib.rs
 M crates/domain/tests/hierarchy_semantics.rs
 M crates/memory/tests/publisher.rs
 M crates/protocol/src/models.rs
 M crates/store/src/lib.rs
 M crates/store/tests/store_contracts.rs
 M create-zips.mjs
 M project/STATUS_MODEL.md
 M project/WORKFLOW_PARITY.md
 M project/build-plan/README.md
 M project/spec/acceptance-profiles.json
 M project/spec/protocol/compatibility.md
 M project/spec/transition-table.md
?? IMPLEMENTATION_REPORT.md
?? REFERENCE_INDEX.md
?? apps/tui/tests/m02-contract.test.mjs
?? crates/application/tests/m02_status_authority.rs
?? crates/domain/src/status_evaluator.rs
?? crates/domain/tests/m02_status.rs
?? crates/protocol/tests/m02_status_wire.rs
?? crates/store/src/status_evaluation.rs
?? crates/store/tests/m02_claim.rs
?? docs/ARCHIVE-OVERLAYS.md
?? memory/
?? project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md
?? project/build-plan/production-completion/
?? project/validation/
?? scripts/apply_overlay.py
?? scripts/validation/m02/
?? scripts/validation/test_apply_overlay.py
```

## repository top level retry
- command: `git rev-parse --show-toplevel`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
/Users/cybertron/Code/boreal-work
```

## lockfiles and package manifests retry
- command: `rg --files -g "Cargo.lock" -g "Cargo.toml" -g "package-lock.json" -g "npm-shrinkwrap.json" -g "pnpm-lock.yaml" -g "yarn.lock" -g "package.json" -g "Makefile" -g "*.mk" | sort`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Cargo.lock
Cargo.toml
apps/tui/package.json
crates/application/Cargo.toml
crates/cli/Cargo.toml
crates/domain/Cargo.toml
crates/memory/Cargo.toml
crates/migration/Cargo.toml
crates/protocol/Cargo.lock
crates/protocol/Cargo.toml
crates/service/Cargo.lock
crates/service/Cargo.toml
crates/source/Cargo.toml
crates/store/Cargo.toml
project/spec/workflows/package.json
scripts/release/fixtures/snapshot/Cargo.toml
scripts/release/fixtures/snapshot/project/spec/workflows/package.json
scripts/validation/concurrency/Cargo.lock
scripts/validation/concurrency/Cargo.toml
scripts/validation/fault/notification-fixture/Cargo.lock
scripts/validation/fault/notification-fixture/Cargo.toml
```

## build and validation scripts retry
- command: `rg --files scripts docs apps crates | rg "(^|/)(build|install|validation|test|ci|Makefile)|package.json$|Cargo.toml$" | sort | sed -n "1,240p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
apps/tui/installer/wizard-body.cjs
apps/tui/installer/wizard.cjs
apps/tui/package.json
apps/tui/src/test.ts
apps/tui/tests/fixtures.mjs
apps/tui/tests/m02-contract.test.mjs
apps/tui/tests/premium.test.mjs
apps/tui/tests/pty-harness.mjs
apps/tui/tests/responsive.test.mjs
crates/application/Cargo.toml
crates/application/tests/boundary_remediation.rs
crates/application/tests/knowledge.rs
crates/application/tests/m02_status_authority.rs
crates/application/tests/p2_guided_flow.rs
crates/application/tests/planning_mutations.rs
crates/application/tests/proof_boundary.rs
crates/application/tests/session_registration.rs
crates/application/tests/sqlite_lifecycle.rs
crates/application/tests/status_projection.rs
crates/application/tests/work_model_v3.rs
crates/cli/Cargo.toml
crates/cli/tests/command_registry.rs
crates/cli/tests/dashboard_launcher.rs
crates/cli/tests/evidence_executor_regressions.rs
crates/cli/tests/evidence_runner_hardening.rs
crates/cli/tests/hierarchy_public.rs
crates/cli/tests/knowledge_routes.rs
crates/cli/tests/operation_readback_contract.rs
crates/cli/tests/outcome_exit.rs
crates/cli/tests/project_setup.rs
crates/cli/tests/release_acceptance.rs
crates/cli/tests/service_signal_recovery.rs
crates/domain/Cargo.toml
crates/domain/tests/hierarchy_semantics.rs
crates/domain/tests/m02_status.rs
crates/domain/tests/work_model_v3.rs
crates/memory/Cargo.toml
crates/memory/tests/publisher.rs
crates/migration/Cargo.toml
crates/migration/tests/format.rs
crates/migration/tests/work_model_v3.rs
crates/protocol/Cargo.toml
crates/protocol/tests/fixtures.rs
crates/protocol/tests/m02_status_wire.rs
crates/service/Cargo.toml
crates/service/tests/transport_smoke.rs
crates/source/Cargo.toml
crates/source/tests/source_engine.rs
crates/source/tests/source_index.rs
crates/store/Cargo.toml
crates/store/tests/m02_claim.rs
crates/store/tests/release_acceptance.rs
crates/store/tests/runtime_backup.rs
crates/store/tests/schema_v3.rs
crates/store/tests/session_registration.rs
crates/store/tests/status_benchmark.rs
crates/store/tests/status_snapshot.rs
crates/store/tests/storage_remediation.rs
crates/store/tests/store_contracts.rs
scripts/build-installer.mjs
scripts/release/build_release.py
scripts/release/fixtures/snapshot/Cargo.toml
scripts/release/fixtures/snapshot/project/spec/workflows/package.json
scripts/release/test_release_identity.py
scripts/validation/concurrency/Cargo.lock
scripts/validation/concurrency/Cargo.toml
scripts/validation/concurrency/README.md
scripts/validation/concurrency/fake_clock.c
scripts/validation/concurrency/production_host.py
scripts/validation/concurrency/run_matrix.py
scripts/validation/concurrency/src/main.rs
scripts/validation/creation/README.md
scripts/validation/creation/run_suite.py
scripts/validation/creation/scenario_matrix.json
scripts/validation/fault/README.md
scripts/validation/fault/notification-fixture/Cargo.lock
scripts/validation/fault/notification-fixture/Cargo.toml
scripts/validation/fault/notification-fixture/src/main.rs
scripts/validation/fault/run_matrix.py
scripts/validation/fault/socket_boundaries.py
scripts/validation/forensic_audit.py
scripts/validation/m02/run_candidate.py
scripts/validation/m02/source_archive_test.py
scripts/validation/mutation/README.md
scripts/validation/mutation/run_matrix.py
scripts/validation/premium/render_preview_pngs.py
scripts/validation/premium/render_previews.mjs
scripts/validation/premium/validate_premium.py
scripts/validation/premium/validate_responsive.py
scripts/validation/process/README.md
scripts/validation/process/claim_race.py
scripts/validation/process/forensic_service.py
scripts/validation/release_performance.py
scripts/validation/run_full_suite.py
scripts/validation/security/probe.sh
scripts/validation/security/v12_envelope.py
scripts/validation/skill_package.py
scripts/validation/soak/README.md
scripts/validation/soak/run.py
scripts/validation/spec_conformance.py
scripts/validation/status/README.md
scripts/validation/status/production_client.py
scripts/validation/status/run_benchmark.py
scripts/validation/test_apply_overlay.py
scripts/validation/test_forensic_audit.py
scripts/validation/test_run_full_suite.py
scripts/validation/tui/README.md
scripts/validation/tui/forensic-closeout.latest.json
scripts/validation/tui/forensic-closeout.latest.md
scripts/validation/tui/forensic_closeout.mjs
scripts/validation/tui/pty_smoke.py
```

## toolchain declarations retry
- command: `rg -n "rust-toolchain|rust-version|engines|node-version|sqlite|cargo (build|test|fmt|clippy)|npm.*typecheck|npm.*test" Cargo.toml Cargo.lock apps scripts docs 2>/dev/null | sed -n "1,260p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
scripts/prepare-test-project.sh:16:database="$state_root/boreal.sqlite"
scripts/prepare-test-project.sh:33:  echo "the TypeScript compiler is unavailable; restore the existing offline npm setup before preparing the test project" >&2
scripts/prepare-test-project.sh:40:if ! npm_config_offline=true npm --prefix "$tui_root" run typecheck; then
scripts/prepare-test-project.sh:97:cargo build --release --locked --offline -p boreal-cli --manifest-path "$workspace_root/Cargo.toml"
scripts/prepare-test-project.sh:145:if command -v sqlite3 >/dev/null 2>&1; then
scripts/prepare-test-project.sh:146:  integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;')
docs/BUILD.md:15:cargo fmt --all -- --check
docs/BUILD.md:16:cargo test --workspace --locked --offline
docs/BUILD.md:17:cargo clippy --workspace --all-targets --locked --offline -- -D warnings
docs/BUILD.md:18:npm run typecheck --prefix apps/tui
docs/BUILD.md:19:npm test --prefix apps/tui
scripts/validation/spec_conformance.py:47:        raise RuntimeError(f"cargo test --list failed with exit {completed.returncode}:\n{output[-4000:]}")
docs/ARCHIVE-OVERLAYS.md:69:cargo fmt --all -- --check
docs/ARCHIVE-OVERLAYS.md:70:cargo test --workspace --locked
docs/ARCHIVE-OVERLAYS.md:71:cargo build --locked -p boreal-cli --bin bwrk
docs/ARCHIVE-OVERLAYS.md:72:npm --prefix apps/tui run typecheck
docs/ARCHIVE-OVERLAYS.md:73:npm --prefix apps/tui test
docs/EVIDENCE_EXECUTOR_TEST_GAPS.md:7:- standard `.boreal/boreal.sqlite` layouts and workspace-root command cwd;
scripts/validation/test_run_full_suite.py:81:    def test_sqlite_floor_failure_is_named_in_the_aggregate_report(self) -> None:
docs/RELEASE_PERFORMANCE.md:50:  --require-sqlite-floor --skip-benchmark \
scripts/validation/process/forensic_service.py:251:    db = root / "boreal.sqlite"
scripts/standalone-check.sh:58:run_check "Rust formatting" cargo fmt --all -- --check
scripts/standalone-check.sh:59:run_check "Rust workspace tests" cargo test --workspace --locked --offline
scripts/standalone-check.sh:60:run_check "Rust workspace clippy" cargo clippy --workspace --all-targets --locked --offline -- -D warnings
scripts/standalone-check.sh:61:run_check "TUI typecheck" npm run typecheck --prefix apps/tui
scripts/standalone-check.sh:62:run_check "TUI tests" npm test --prefix apps/tui
scripts/validation/process/claim_race.py:158:        database = root / "boreal.sqlite"
scripts/validation/forensic_audit.py:105:                    ("npm", "test", "--prefix", "apps/tui"),
scripts/validation/forensic_audit.py:116:                Check("TUI protocol/status tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:149:                    cargo_args("-p", "boreal-application", "--test", "sqlite_lifecycle", "accepted_receipts_drive_durable_proof_gated_closeout", online=online),
scripts/validation/forensic_audit.py:155:                Check("mounted TUI workflow tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:165:                Check("TUI mutation/error tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:237:                Check("TUI framing and payload tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/security/v12_envelope.py:159:        fail(f"cargo build completed but {candidate} is unavailable")
scripts/validation/security/v12_envelope.py:466:        db = fixture / "boreal.sqlite"
scripts/guided-closeout-smoke.sh:7:DB="$TMP/boreal.sqlite"
scripts/guided-closeout-smoke.sh:15:cargo build -p boreal-cli --locked --offline >/dev/null
scripts/guided-closeout-smoke.sh:29:sqlite3 "$DB" "INSERT INTO source_version (source_version_id, project_id, origin, access_scope, content_digest, media_type, byte_count, captured_at, parser_identity, availability, citation_json) VALUES ('sha256:source-fixture-v1', 'guided-project', 'guided-fixture', 'project', 'sha256:source-fixture-v1', 'text/plain', 0, 'unix-ms:1', 'fixture/1', 'available', '[]');"
scripts/validation/m02/run_candidate.py:30:    ('tui-typecheck', 'TypeScript compiler', ['npm', '--prefix', 'apps/tui', 'run', 'typecheck']),
scripts/validation/m02/run_candidate.py:31:    ('tui-tests', 'core suite + Node unit/presentation fixtures', ['npm', '--prefix', 'apps/tui', 'test']),
scripts/validation/tui/forensic_closeout.mjs:457:  const db = join(fixture, "boreal.sqlite");
scripts/dashboard-smoke.sh:14:DB="$STATE_ROOT/boreal.sqlite"
scripts/dashboard-smoke.sh:51:  if ! cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline \
scripts/validation/premium/validate_responsive.py:45:                'database': str(self.root/'project/.boreal/boreal.sqlite'),
scripts/validation/creation/run_suite.py:5:the supplied project root.  It never touches test-project/.boreal/boreal.sqlite
scripts/validation/creation/run_suite.py:61:        self.database = self.state_root / "boreal.sqlite"
scripts/validation/m02/source_archive_test.py:49:            if entry.suffix.lower() in {'.ttf', '.otf', '.woff', '.woff2', '.sqlite', '.db', '.exe', '.so', '.dylib'}:
scripts/validation/m02/source_archive_test.py:77:        run(['npm', '--prefix', 'apps/tui', 'test'], checkout)
scripts/validation/tui/pty_smoke.py:114:        database = root / "boreal.sqlite"
scripts/release/fixtures/snapshot/project/spec/manifest.json:5:  "schema_version": "boreal.sqlite/2",
scripts/validation/release_performance.py:108:        "--require-sqlite-floor",
scripts/validation/release_performance.py:136:            "sqlite_runtime_floor": "3.51.3",
scripts/validation/release_performance.py:137:            "sqlite_floor_action": "release gate; report unsupported when linked runtime is below floor",
scripts/validation/release_performance.py:138:            "sqlite_floor_enforced": args.require_sqlite_floor,
scripts/validation/release_performance.py:230:    if args.require_sqlite_floor and not evidence["runtime"]["meets_floor"]:
scripts/validation/creation/scenario_matrix.json:196:      "coverage": "npm --prefix apps/tui test plus dashboard/service smoke",
scripts/validation/premium/render_previews.mjs:41:const project = createWizardState('project', { project_id:'boreal-work',project_root:'/workspace/boreal-work',database:'/workspace/boreal-work/.boreal/boreal.sqlite',memory_root:'/workspace/boreal-work/memory',agents:['codex','claude'],memory_layout:'child' });
scripts/validation/creation/README.md:5:not reset or mutate `test-project/.boreal/boreal.sqlite`.
scripts/service-smoke.sh:11:DB="$SMOKE_DIR/work.sqlite"
scripts/service-smoke.sh:45:  cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
scripts/validation/run_full_suite.py:66:    sqlite_floor_failure = (
scripts/validation/run_full_suite.py:83:        if sqlite_floor_failure
scripts/validation/run_full_suite.py:168:    binary: Path, log_dir: Path, *, require_sqlite_floor: bool
scripts/validation/run_full_suite.py:189:        runtime = envelope["data"]["sqlite_runtime"]
scripts/validation/run_full_suite.py:198:    result["sqlite_runtime"] = {
scripts/validation/run_full_suite.py:204:    if require_sqlite_floor and not meets_floor:
scripts/validation/run_full_suite.py:240:        "--require-sqlite-floor",
scripts/validation/run_full_suite.py:276:        args.require_sqlite_floor = True
scripts/validation/run_full_suite.py:299:        # `cargo test --workspace` does not guarantee that the bwrk binary
scripts/validation/run_full_suite.py:327:    if args.require_sqlite_floor:
scripts/validation/run_full_suite.py:332:                require_sqlite_floor=True,
scripts/validation/run_full_suite.py:338:            ["npm", "--prefix", "apps/tui", "test"],
scripts/validation/run_full_suite.py:515:        if args.require_sqlite_floor:
scripts/validation/run_full_suite.py:516:            release_command.append("--require-sqlite-floor")
scripts/validation/run_full_suite.py:560:            "require_sqlite_floor": args.require_sqlite_floor,
scripts/validation/premium/validate_premium.py:207:        return {'project_id':'boreal-work','project_root':str(self.root/'project'),'database':str(self.root/'project/.boreal/boreal.sqlite'),'memory_root':str(self.root/'project/memory'),'agents':['codex'],'memory_layout':'child'}
scripts/validation/concurrency/src/main.rs:79:    let db_path = db_root.join("probe.sqlite3");
apps/tui/package.json:5:  "engines": {
scripts/validation/fault/run_matrix.py:250:        "command_profile": "cargo test --locked with network resolution"
scripts/validation/fault/run_matrix.py:252:        else "cargo test --locked --offline",
scripts/validation/status/run_benchmark.py:49:            "run cargo test directly with --nocapture to inspect output"
scripts/validation/status/production_client.py:124:    sqlite = shutil.which("sqlite3")
scripts/validation/status/production_client.py:125:    if sqlite is None:
scripts/validation/status/production_client.py:126:        raise RuntimeError("sqlite3 CLI is required to seed the V11 scale fixture")
scripts/validation/status/production_client.py:150:        [sqlite, str(database)],
scripts/validation/status/production_client.py:160:        "method": "sqlite3 CLI after bwrk init",
scripts/validation/status/production_client.py:250:        "service_sqlite_prepare_count": queries,
scripts/validation/status/production_client.py:304:        database = root / "boreal.sqlite"
scripts/validation/status/production_client.py:424:                    page_101["service_sqlite_prepare_count"],
scripts/validation/status/production_client.py:425:                    page_1001["service_sqlite_prepare_count"],
apps/tui/tests/premium.test.mjs:25:    return createWizardState('project', { project_id: 'boreal-work', project_root: '/workspace/boreal', database: '/workspace/boreal/.boreal/boreal.sqlite', memory_root: '/workspace/boreal/memory', memory_layout: 'child', agents: ['codex'], ...overrides });
apps/tui/tests/premium.test.mjs:326:    const s = project({ project_root: '/workspace/' + 'nested/'.repeat(15), database: '/workspace/' + 'nested/'.repeat(15) + '.boreal/boreal.sqlite' });
scripts/validation/concurrency/production_host.py:380:        database = root / "boreal.sqlite"
apps/tui/tests/responsive.test.mjs:17:const project = () => createWizardState('project', { project_id:'boreal-work', project_root:'/work/boreal', database:'/work/boreal/.boreal/boreal.sqlite', memory_root:'/work/boreal/memory', agents:['codex'], memory_layout:'child' });
scripts/tui-service-smoke.sh:12:DB="$SMOKE_DIR/work.sqlite"
scripts/tui-service-smoke.sh:48:cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
scripts/tui-service-smoke.sh:49:npm --prefix "$PACKAGE_ROOT/apps/tui" test
scripts/release/build_release.py:223:    value = package.get("engines", {}).get("node")
```

## python package sqlite library paths retry
- command: `python3 -c "import sqlite3,sys; print(sqlite3.__file__); print(sys.executable)"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
/opt/homebrew/Cellar/python@3.14/3.14.3_1/Frameworks/Python.framework/Versions/3.14/lib/python3.14/sqlite3/__init__.py
/opt/homebrew/opt/python@3.14/bin/python3.14
```

## Long-running validation commands intentionally skipped
- command: cargo test --locked --workspace; npm --prefix apps/tui test; node scripts/build-installer.mjs --check
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit_status: not_run
- classification: skipped
- relevant_output: Not attempted because this worker is limited to quick probes and must not run unbounded builds/tests.

## direct npx tsc no-install version
- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:00:46-06:00
- exit_status: 1
- classification: fail
- relevant_output:
```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/tsc failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the
npm error network 'proxy' config is set properly.  See: 'npm help config'
npm error Log files were not written due to an error writing to the directory: /Users/cybertron/.npm/_logs
npm error You can rerun the command with `--loglevel=verbose` to see the logs in your terminal
```

## direct tsc version
- command: `tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Version 5.4.5
```

## direct cargo version
- command: `cargo --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
cargo 1.85.0
```

## direct rustc version
- command: `rustc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
```

## direct rustfmt version
- command: `rustfmt --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
rustfmt 1.8.0
```

## direct git version
- command: `git --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
git version 2.47.0
```

## direct zsh version
- command: `zsh --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
zsh 5.9 (arm64-apple-darwin24.0)
```

## direct tar version
- command: `tar --version | sed -n "1p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
bsdtar 3.5.3 - libarchive 3.5.3 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8 
```

## direct sqlite3 version
- command: `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
3.43.2 2023-10-10 13:08:14 1b37c146ee9ebb7acd0160c0ab1fd11017a419fa8a3187386ed8cb32b709aapl (64-bit)
```

## sqlite3 compile options
- command: `sqlite3 :memory: "pragma compile_options;"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
ATOMIC_INTRINSICS=1
BUG_COMPATIBLE_20160819
CCCRYPT256
COMPILER=clang-16.0.0
DEFAULT_AUTOVACUUM
DEFAULT_CACHE_SIZE=2000
DEFAULT_CKPTFULLFSYNC
DEFAULT_FILE_FORMAT=4
DEFAULT_JOURNAL_SIZE_LIMIT=32768
DEFAULT_LOOKASIDE=1200,102
DEFAULT_MEMSTATUS=0
DEFAULT_MMAP_SIZE=0
DEFAULT_PAGE_SIZE=4096
DEFAULT_PCACHE_INITSZ=20
DEFAULT_RECURSIVE_TRIGGERS
DEFAULT_SECTOR_SIZE=4096
DEFAULT_SYNCHRONOUS=2
DEFAULT_WAL_AUTOCHECKPOINT=1000
DEFAULT_WAL_SYNCHRONOUS=1
DEFAULT_WORKER_THREADS=0
DQS=3
ENABLE_API_ARMOR
ENABLE_BYTECODE_VTAB
ENABLE_COLUMN_METADATA
ENABLE_DBPAGE_VTAB
ENABLE_DBSTAT_VTAB
ENABLE_EXPLAIN_COMMENTS
ENABLE_FTS3
ENABLE_FTS3_PARENTHESIS
ENABLE_FTS3_TOKENIZER
ENABLE_FTS4
ENABLE_FTS5
ENABLE_LOCKING_STYLE=1
ENABLE_MATH_FUNCTIONS
ENABLE_NORMALIZE
ENABLE_PREUPDATE_HOOK
ENABLE_RTREE
ENABLE_SESSION
ENABLE_SNAPSHOT
ENABLE_SQLLOG
ENABLE_STMT_SCANSTATUS
ENABLE_UNKNOWN_SQL_FUNCTION
ENABLE_UPDATE_DELETE_LIMIT
HAS_CODEC_RESTRICTED
HAVE_ISNAN
MALLOC_SOFT_LIMIT=1024
MAX_ATTACHED=10
MAX_COLUMN=2000
MAX_COMPOUND_SELECT=500
MAX_DEFAULT_PAGE_SIZE=8192
MAX_EXPR_DEPTH=1000
MAX_FUNCTION_ARG=127
MAX_LENGTH=2147483645
MAX_LIKE_PATTERN_LENGTH=50000
MAX_MMAP_SIZE=1073741824
MAX_PAGE_COUNT=1073741823
MAX_PAGE_SIZE=65536
MAX_SQL_LENGTH=1000000000
MAX_TRIGGER_DEPTH=1000
MAX_VARIABLE_NUMBER=500000
MAX_VDBE_OP=250000000
MAX_WORKER_THREADS=8
MUTEX_UNFAIR
OMIT_AUTORESET
OMIT_LOAD_EXTENSION
STMTJRNL_SPILL=131072
SYSTEM_MALLOC
TEMP_STORE=1
THREADSAFE=2
USE_URI
```

## python sqlite runtime
- command: `python3 -c "import sqlite3; print(sqlite3.sqlite_version); print(sqlite3.version)"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:56-06:00
- exit_status: 1
- classification: fail
- relevant_output:
```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import sqlite3; print(sqlite3.sqlite_version); print(sqlite3.version)
                                                         ^^^^^^^^^^^^^^^
AttributeError: module 'sqlite3' has no attribute 'version'
3.53.4
```

## unix socket disposable path
- command: `p=/tmp/boreal-pf-s00-t02-3.sock; rm -f "$p"; python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); print(\"bound\",sys.argv[1]); s.close()" "$p"; rc=$?; rm -f "$p"; exit $rc`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 1
- classification: fail
- relevant_output:
```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); print("bound",sys.argv[1]); s.close()
                                                        ~~~~~~^^^^^^^^^^^^^
PermissionError: [Errno 1] Operation not permitted
```

## git status current dirty tree
- command: `git status --short --branch`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
## codex/apply-responsive-terminal-overlay...origin/codex/apply-responsive-terminal-overlay [ahead 1]
 M MASTER_PLAN.md
 M apps/tui/src/client.ts
 M apps/tui/src/ui/dashboard.ts
 M crates/application/src/lib.rs
 M crates/application/src/status.rs
 M crates/application/tests/boundary_remediation.rs
 M crates/application/tests/p2_guided_flow.rs
 M crates/application/tests/work_model_v3.rs
 M crates/cli/src/main.rs
 M crates/cli/src/service.rs
 M crates/cli/src/update.rs
 M crates/cli/tests/command_registry.rs
 M crates/cli/tests/project_setup.rs
 M crates/cli/tests/service_signal_recovery.rs
 M crates/domain/src/lib.rs
 M crates/domain/tests/hierarchy_semantics.rs
 M crates/memory/tests/publisher.rs
 M crates/protocol/src/models.rs
 M crates/store/src/lib.rs
 M crates/store/tests/store_contracts.rs
 M create-zips.mjs
 M project/STATUS_MODEL.md
 M project/WORKFLOW_PARITY.md
 M project/build-plan/README.md
 M project/spec/acceptance-profiles.json
 M project/spec/protocol/compatibility.md
 M project/spec/transition-table.md
?? IMPLEMENTATION_REPORT.md
?? REFERENCE_INDEX.md
?? apps/tui/tests/m02-contract.test.mjs
?? crates/application/tests/m02_status_authority.rs
?? crates/domain/src/status_evaluator.rs
?? crates/domain/tests/m02_status.rs
?? crates/protocol/tests/m02_status_wire.rs
?? crates/store/src/status_evaluation.rs
?? crates/store/tests/m02_claim.rs
?? docs/ARCHIVE-OVERLAYS.md
?? memory/
?? project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md
?? project/build-plan/production-completion/
?? project/validation/
?? scripts/apply_overlay.py
?? scripts/validation/m02/
?? scripts/validation/test_apply_overlay.py
```

## repository top level
- command: `git rev-parse --show-toplevel`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
/Users/cybertron/Code/boreal-work
```

## lockfiles and package manifests
- command: `rg --files -g "Cargo.lock" -g "Cargo.toml" -g "package-lock.json" -g "npm-shrinkwrap.json" -g "pnpm-lock.yaml" -g "yarn.lock" -g "package.json" -g "Makefile" -g "*.mk" | sort`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
Cargo.lock
Cargo.toml
apps/tui/package.json
crates/application/Cargo.toml
crates/cli/Cargo.toml
crates/domain/Cargo.toml
crates/memory/Cargo.toml
crates/migration/Cargo.toml
crates/protocol/Cargo.lock
crates/protocol/Cargo.toml
crates/service/Cargo.lock
crates/service/Cargo.toml
crates/source/Cargo.toml
crates/store/Cargo.toml
project/spec/workflows/package.json
scripts/release/fixtures/snapshot/Cargo.toml
scripts/release/fixtures/snapshot/project/spec/workflows/package.json
scripts/validation/concurrency/Cargo.lock
scripts/validation/concurrency/Cargo.toml
scripts/validation/fault/notification-fixture/Cargo.lock
scripts/validation/fault/notification-fixture/Cargo.toml
```

## build and validation scripts
- command: `rg --files scripts docs apps crates | rg "(^|/)(build|install|validation|test|ci|Makefile)|package.json$|Cargo.toml$" | sort | sed -n "1,240p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
apps/tui/installer/wizard-body.cjs
apps/tui/installer/wizard.cjs
apps/tui/package.json
apps/tui/src/test.ts
apps/tui/tests/fixtures.mjs
apps/tui/tests/m02-contract.test.mjs
apps/tui/tests/premium.test.mjs
apps/tui/tests/pty-harness.mjs
apps/tui/tests/responsive.test.mjs
crates/application/Cargo.toml
crates/application/tests/boundary_remediation.rs
crates/application/tests/knowledge.rs
crates/application/tests/m02_status_authority.rs
crates/application/tests/p2_guided_flow.rs
crates/application/tests/planning_mutations.rs
crates/application/tests/proof_boundary.rs
crates/application/tests/session_registration.rs
crates/application/tests/sqlite_lifecycle.rs
crates/application/tests/status_projection.rs
crates/application/tests/work_model_v3.rs
crates/cli/Cargo.toml
crates/cli/tests/command_registry.rs
crates/cli/tests/dashboard_launcher.rs
crates/cli/tests/evidence_executor_regressions.rs
crates/cli/tests/evidence_runner_hardening.rs
crates/cli/tests/hierarchy_public.rs
crates/cli/tests/knowledge_routes.rs
crates/cli/tests/operation_readback_contract.rs
crates/cli/tests/outcome_exit.rs
crates/cli/tests/project_setup.rs
crates/cli/tests/release_acceptance.rs
crates/cli/tests/service_signal_recovery.rs
crates/domain/Cargo.toml
crates/domain/tests/hierarchy_semantics.rs
crates/domain/tests/m02_status.rs
crates/domain/tests/work_model_v3.rs
crates/memory/Cargo.toml
crates/memory/tests/publisher.rs
crates/migration/Cargo.toml
crates/migration/tests/format.rs
crates/migration/tests/work_model_v3.rs
crates/protocol/Cargo.toml
crates/protocol/tests/fixtures.rs
crates/protocol/tests/m02_status_wire.rs
crates/service/Cargo.toml
crates/service/tests/transport_smoke.rs
crates/source/Cargo.toml
crates/source/tests/source_engine.rs
crates/source/tests/source_index.rs
crates/store/Cargo.toml
crates/store/tests/m02_claim.rs
crates/store/tests/release_acceptance.rs
crates/store/tests/runtime_backup.rs
crates/store/tests/schema_v3.rs
crates/store/tests/session_registration.rs
crates/store/tests/status_benchmark.rs
crates/store/tests/status_snapshot.rs
crates/store/tests/storage_remediation.rs
crates/store/tests/store_contracts.rs
scripts/build-installer.mjs
scripts/release/build_release.py
scripts/release/fixtures/snapshot/Cargo.toml
scripts/release/fixtures/snapshot/project/spec/workflows/package.json
scripts/release/test_release_identity.py
scripts/validation/concurrency/Cargo.lock
scripts/validation/concurrency/Cargo.toml
scripts/validation/concurrency/README.md
scripts/validation/concurrency/fake_clock.c
scripts/validation/concurrency/production_host.py
scripts/validation/concurrency/run_matrix.py
scripts/validation/concurrency/src/main.rs
scripts/validation/creation/README.md
scripts/validation/creation/run_suite.py
scripts/validation/creation/scenario_matrix.json
scripts/validation/fault/README.md
scripts/validation/fault/notification-fixture/Cargo.lock
scripts/validation/fault/notification-fixture/Cargo.toml
scripts/validation/fault/notification-fixture/src/main.rs
scripts/validation/fault/run_matrix.py
scripts/validation/fault/socket_boundaries.py
scripts/validation/forensic_audit.py
scripts/validation/m02/run_candidate.py
scripts/validation/m02/source_archive_test.py
scripts/validation/mutation/README.md
scripts/validation/mutation/run_matrix.py
scripts/validation/premium/render_preview_pngs.py
scripts/validation/premium/render_previews.mjs
scripts/validation/premium/validate_premium.py
scripts/validation/premium/validate_responsive.py
scripts/validation/process/README.md
scripts/validation/process/claim_race.py
scripts/validation/process/forensic_service.py
scripts/validation/release_performance.py
scripts/validation/run_full_suite.py
scripts/validation/security/probe.sh
scripts/validation/security/v12_envelope.py
scripts/validation/skill_package.py
scripts/validation/soak/README.md
scripts/validation/soak/run.py
scripts/validation/spec_conformance.py
scripts/validation/status/README.md
scripts/validation/status/production_client.py
scripts/validation/status/run_benchmark.py
scripts/validation/test_apply_overlay.py
scripts/validation/test_forensic_audit.py
scripts/validation/test_run_full_suite.py
scripts/validation/tui/README.md
scripts/validation/tui/forensic-closeout.latest.json
scripts/validation/tui/forensic-closeout.latest.md
scripts/validation/tui/forensic_closeout.mjs
scripts/validation/tui/pty_smoke.py
```

## toolchain declarations
- command: `rg -n "rust-toolchain|rust-version|engines|node-version|sqlite|cargo (build|test|fmt|clippy)|npm.*typecheck|npm.*test" Cargo.toml Cargo.lock apps scripts docs 2>/dev/null | sed -n "1,260p"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
scripts/prepare-test-project.sh:16:database="$state_root/boreal.sqlite"
scripts/prepare-test-project.sh:33:  echo "the TypeScript compiler is unavailable; restore the existing offline npm setup before preparing the test project" >&2
scripts/prepare-test-project.sh:40:if ! npm_config_offline=true npm --prefix "$tui_root" run typecheck; then
scripts/prepare-test-project.sh:97:cargo build --release --locked --offline -p boreal-cli --manifest-path "$workspace_root/Cargo.toml"
scripts/prepare-test-project.sh:145:if command -v sqlite3 >/dev/null 2>&1; then
scripts/prepare-test-project.sh:146:  integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;')
docs/BUILD.md:15:cargo fmt --all -- --check
docs/BUILD.md:16:cargo test --workspace --locked --offline
docs/BUILD.md:17:cargo clippy --workspace --all-targets --locked --offline -- -D warnings
docs/BUILD.md:18:npm run typecheck --prefix apps/tui
docs/BUILD.md:19:npm test --prefix apps/tui
scripts/validation/spec_conformance.py:47:        raise RuntimeError(f"cargo test --list failed with exit {completed.returncode}:\n{output[-4000:]}")
docs/ARCHIVE-OVERLAYS.md:69:cargo fmt --all -- --check
docs/ARCHIVE-OVERLAYS.md:70:cargo test --workspace --locked
docs/ARCHIVE-OVERLAYS.md:71:cargo build --locked -p boreal-cli --bin bwrk
docs/ARCHIVE-OVERLAYS.md:72:npm --prefix apps/tui run typecheck
docs/ARCHIVE-OVERLAYS.md:73:npm --prefix apps/tui test
scripts/validation/process/forensic_service.py:251:    db = root / "boreal.sqlite"
scripts/validation/process/claim_race.py:158:        database = root / "boreal.sqlite"
scripts/validation/premium/validate_responsive.py:45:                'database': str(self.root/'project/.boreal/boreal.sqlite'),
scripts/validation/test_run_full_suite.py:81:    def test_sqlite_floor_failure_is_named_in_the_aggregate_report(self) -> None:
docs/RELEASE_PERFORMANCE.md:50:  --require-sqlite-floor --skip-benchmark \
docs/EVIDENCE_EXECUTOR_TEST_GAPS.md:7:- standard `.boreal/boreal.sqlite` layouts and workspace-root command cwd;
scripts/validation/premium/render_previews.mjs:41:const project = createWizardState('project', { project_id:'boreal-work',project_root:'/workspace/boreal-work',database:'/workspace/boreal-work/.boreal/boreal.sqlite',memory_root:'/workspace/boreal-work/memory',agents:['codex','claude'],memory_layout:'child' });
scripts/guided-closeout-smoke.sh:7:DB="$TMP/boreal.sqlite"
scripts/guided-closeout-smoke.sh:15:cargo build -p boreal-cli --locked --offline >/dev/null
scripts/guided-closeout-smoke.sh:29:sqlite3 "$DB" "INSERT INTO source_version (source_version_id, project_id, origin, access_scope, content_digest, media_type, byte_count, captured_at, parser_identity, availability, citation_json) VALUES ('sha256:source-fixture-v1', 'guided-project', 'guided-fixture', 'project', 'sha256:source-fixture-v1', 'text/plain', 0, 'unix-ms:1', 'fixture/1', 'available', '[]');"
scripts/service-smoke.sh:11:DB="$SMOKE_DIR/work.sqlite"
scripts/service-smoke.sh:45:  cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
scripts/tui-service-smoke.sh:12:DB="$SMOKE_DIR/work.sqlite"
scripts/tui-service-smoke.sh:48:cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
scripts/tui-service-smoke.sh:49:npm --prefix "$PACKAGE_ROOT/apps/tui" test
scripts/validation/forensic_audit.py:105:                    ("npm", "test", "--prefix", "apps/tui"),
scripts/validation/forensic_audit.py:116:                Check("TUI protocol/status tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:149:                    cargo_args("-p", "boreal-application", "--test", "sqlite_lifecycle", "accepted_receipts_drive_durable_proof_gated_closeout", online=online),
scripts/validation/forensic_audit.py:155:                Check("mounted TUI workflow tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:165:                Check("TUI mutation/error tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/forensic_audit.py:237:                Check("TUI framing and payload tests", ("npm", "test", "--prefix", "apps/tui")),
scripts/validation/security/v12_envelope.py:159:        fail(f"cargo build completed but {candidate} is unavailable")
scripts/validation/security/v12_envelope.py:466:        db = fixture / "boreal.sqlite"
scripts/dashboard-smoke.sh:14:DB="$STATE_ROOT/boreal.sqlite"
scripts/dashboard-smoke.sh:51:  if ! cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline \
scripts/validation/premium/validate_premium.py:207:        return {'project_id':'boreal-work','project_root':str(self.root/'project'),'database':str(self.root/'project/.boreal/boreal.sqlite'),'memory_root':str(self.root/'project/memory'),'agents':['codex'],'memory_layout':'child'}
scripts/validation/tui/forensic_closeout.mjs:457:  const db = join(fixture, "boreal.sqlite");
scripts/standalone-check.sh:58:run_check "Rust formatting" cargo fmt --all -- --check
scripts/standalone-check.sh:59:run_check "Rust workspace tests" cargo test --workspace --locked --offline
scripts/standalone-check.sh:60:run_check "Rust workspace clippy" cargo clippy --workspace --all-targets --locked --offline -- -D warnings
scripts/standalone-check.sh:61:run_check "TUI typecheck" npm run typecheck --prefix apps/tui
scripts/standalone-check.sh:62:run_check "TUI tests" npm test --prefix apps/tui
scripts/validation/fault/run_matrix.py:250:        "command_profile": "cargo test --locked with network resolution"
scripts/validation/fault/run_matrix.py:252:        else "cargo test --locked --offline",
scripts/validation/tui/pty_smoke.py:114:        database = root / "boreal.sqlite"
scripts/release/build_release.py:223:    value = package.get("engines", {}).get("node")
scripts/release/fixtures/snapshot/project/spec/manifest.json:5:  "schema_version": "boreal.sqlite/2",
scripts/validation/run_full_suite.py:66:    sqlite_floor_failure = (
scripts/validation/run_full_suite.py:83:        if sqlite_floor_failure
scripts/validation/run_full_suite.py:168:    binary: Path, log_dir: Path, *, require_sqlite_floor: bool
scripts/validation/run_full_suite.py:189:        runtime = envelope["data"]["sqlite_runtime"]
scripts/validation/run_full_suite.py:198:    result["sqlite_runtime"] = {
scripts/validation/run_full_suite.py:204:    if require_sqlite_floor and not meets_floor:
scripts/validation/run_full_suite.py:240:        "--require-sqlite-floor",
scripts/validation/run_full_suite.py:276:        args.require_sqlite_floor = True
scripts/validation/run_full_suite.py:299:        # `cargo test --workspace` does not guarantee that the bwrk binary
scripts/validation/run_full_suite.py:327:    if args.require_sqlite_floor:
scripts/validation/run_full_suite.py:332:                require_sqlite_floor=True,
scripts/validation/run_full_suite.py:338:            ["npm", "--prefix", "apps/tui", "test"],
scripts/validation/run_full_suite.py:515:        if args.require_sqlite_floor:
scripts/validation/run_full_suite.py:516:            release_command.append("--require-sqlite-floor")
scripts/validation/run_full_suite.py:560:            "require_sqlite_floor": args.require_sqlite_floor,
scripts/validation/m02/run_candidate.py:30:    ('tui-typecheck', 'TypeScript compiler', ['npm', '--prefix', 'apps/tui', 'run', 'typecheck']),
scripts/validation/m02/run_candidate.py:31:    ('tui-tests', 'core suite + Node unit/presentation fixtures', ['npm', '--prefix', 'apps/tui', 'test']),
scripts/validation/m02/source_archive_test.py:49:            if entry.suffix.lower() in {'.ttf', '.otf', '.woff', '.woff2', '.sqlite', '.db', '.exe', '.so', '.dylib'}:
scripts/validation/m02/source_archive_test.py:77:        run(['npm', '--prefix', 'apps/tui', 'test'], checkout)
scripts/validation/creation/run_suite.py:5:the supplied project root.  It never touches test-project/.boreal/boreal.sqlite
scripts/validation/creation/run_suite.py:61:        self.database = self.state_root / "boreal.sqlite"
scripts/validation/release_performance.py:108:        "--require-sqlite-floor",
scripts/validation/release_performance.py:136:            "sqlite_runtime_floor": "3.51.3",
scripts/validation/release_performance.py:137:            "sqlite_floor_action": "release gate; report unsupported when linked runtime is below floor",
scripts/validation/release_performance.py:138:            "sqlite_floor_enforced": args.require_sqlite_floor,
scripts/validation/release_performance.py:230:    if args.require_sqlite_floor and not evidence["runtime"]["meets_floor"]:
scripts/validation/status/run_benchmark.py:49:            "run cargo test directly with --nocapture to inspect output"
scripts/validation/creation/scenario_matrix.json:196:      "coverage": "npm --prefix apps/tui test plus dashboard/service smoke",
apps/tui/tests/premium.test.mjs:25:    return createWizardState('project', { project_id: 'boreal-work', project_root: '/workspace/boreal', database: '/workspace/boreal/.boreal/boreal.sqlite', memory_root: '/workspace/boreal/memory', memory_layout: 'child', agents: ['codex'], ...overrides });
apps/tui/tests/premium.test.mjs:326:    const s = project({ project_root: '/workspace/' + 'nested/'.repeat(15), database: '/workspace/' + 'nested/'.repeat(15) + '.boreal/boreal.sqlite' });
apps/tui/package.json:5:  "engines": {
scripts/validation/status/production_client.py:124:    sqlite = shutil.which("sqlite3")
scripts/validation/status/production_client.py:125:    if sqlite is None:
scripts/validation/status/production_client.py:126:        raise RuntimeError("sqlite3 CLI is required to seed the V11 scale fixture")
scripts/validation/status/production_client.py:150:        [sqlite, str(database)],
scripts/validation/status/production_client.py:160:        "method": "sqlite3 CLI after bwrk init",
scripts/validation/status/production_client.py:250:        "service_sqlite_prepare_count": queries,
scripts/validation/status/production_client.py:304:        database = root / "boreal.sqlite"
scripts/validation/status/production_client.py:424:                    page_101["service_sqlite_prepare_count"],
scripts/validation/status/production_client.py:425:                    page_1001["service_sqlite_prepare_count"],
apps/tui/tests/responsive.test.mjs:17:const project = () => createWizardState('project', { project_id:'boreal-work', project_root:'/work/boreal', database:'/work/boreal/.boreal/boreal.sqlite', memory_root:'/work/boreal/memory', agents:['codex'], memory_layout:'child' });
scripts/validation/creation/README.md:5:not reset or mutate `test-project/.boreal/boreal.sqlite`.
scripts/validation/concurrency/production_host.py:380:        database = root / "boreal.sqlite"
scripts/validation/concurrency/src/main.rs:79:    let db_path = db_root.join("probe.sqlite3");
```

## python package sqlite library paths
- command: `python3 -c "import sqlite3,sys; print(sqlite3.__file__); print(sys.executable)"`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: 0
- classification: pass
- relevant_output:
```text
/opt/homebrew/Cellar/python@3.14/3.14.3_1/Frameworks/Python.framework/Versions/3.14/lib/python3.14/sqlite3/__init__.py
/opt/homebrew/opt/python@3.14/bin/python3.14
```

## Long-running validation commands intentionally skipped
- command: cargo test --locked --workspace; npm --prefix apps/tui test; node scripts/build-installer.mjs --check
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:57-06:00
- exit_status: not_run
- classification: skipped
- relevant_output: Not attempted because this worker is limited to quick probes and must not run unbounded builds/tests.
