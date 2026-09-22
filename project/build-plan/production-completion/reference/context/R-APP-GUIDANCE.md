# R-APP-GUIDANCE — crates/application/src/guidance.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/guidance.rs:L1–L260`  
**File SHA-256:** `84c15313887f610e7b5a88c8e6c01cf6d4dc4977731dd8adf29776245b110a3e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Trusted guidance composition; consume domain action descriptors, never make a second policy engine.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/application/src/guidance.rs'
```

## Exact baseline excerpt

````text
    1 | //! Trusted, versioned guidance selection. Authored text is never executable.
    2 | 
    3 | use boreal_domain::DerivedStatus;
    4 | 
    5 | const SAFE_RUNNERS: &[&str] = &["boreal_cli", "bounded_declared_gate"];
    6 | 
    7 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    8 | pub enum DirectiveSeverity {
    9 |     Blocking,
   10 |     Required,
   11 |     Advisory,
   12 | }
   13 | 
   14 | impl DirectiveSeverity {
   15 |     pub const fn requires_action(self) -> bool {
   16 |         matches!(self, Self::Blocking | Self::Required)
   17 |     }
   18 | }
   19 | 
   20 | #[derive(Clone, Debug, Eq, PartialEq)]
   21 | pub enum DirectiveValidationError {
   22 |     EmptyField(&'static str),
   23 |     EmptySafeArgv,
   24 |     MissingJsonFlag,
   25 |     UnsafeSafeArg,
   26 |     ShellExecution,
   27 |     UnsupportedRunner,
   28 |     InconsistentSeverity,
   29 | }
   30 | 
   31 | impl std::fmt::Display for DirectiveValidationError {
   32 |     fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
   33 |         match self {
   34 |             Self::EmptyField(field) => write!(formatter, "directive field {field} is empty"),
   35 |             Self::EmptySafeArgv => formatter.write_str("directive safe_argv is empty"),
   36 |             Self::MissingJsonFlag => formatter.write_str("directive safe_argv must include --json"),
   37 |             Self::UnsafeSafeArg => {
   38 |                 formatter.write_str("directive safe_argv contains an unsafe argument")
   39 |             }
   40 |             Self::ShellExecution => formatter.write_str("directive shell execution is not allowed"),
   41 |             Self::UnsupportedRunner => formatter.write_str("directive runner is not allowlisted"),
   42 |             Self::InconsistentSeverity => {
   43 |                 formatter.write_str("directive action_required does not match its severity")
   44 |             }
   45 |         }
   46 |     }
   47 | }
   48 | 
   49 | impl std::error::Error for DirectiveValidationError {}
   50 | 
   51 | #[derive(Clone, Debug, Eq, PartialEq)]
   52 | pub struct GuidanceContext<'a> {
   53 |     pub work_id: &'a str,
   54 |     pub status: DerivedStatus,
   55 |     pub reason_codes: &'a [String],
   56 |     pub has_goal: bool,
   57 | }
   58 | 
   59 | #[derive(Clone, Debug, Eq, PartialEq)]
   60 | pub struct Directive {
   61 |     pub registry_id: &'static str,
   62 |     pub version: &'static str,
   63 |     pub explanation: &'static str,
   64 |     pub safe_argv: &'static [&'static str],
   65 |     pub severity: DirectiveSeverity,
   66 |     pub action_required: bool,
   67 |     pub runner: &'static str,
   68 |     pub shell: bool,
   69 | }
   70 | 
   71 | impl Directive {
   72 |     /// Validate the boundary an unfamiliar harness must honor before acting.
   73 |     ///
   74 |     /// Display text is never parsed into a command, and no directive can opt
   75 |     /// into shell execution or omit the machine-readable response flag.
   76 |     pub fn validate(&self) -> Result<(), DirectiveValidationError> {
   77 |         for (name, value) in [
   78 |             ("registry_id", self.registry_id),
   79 |             ("version", self.version),
   80 |             ("explanation", self.explanation),
   81 |         ] {
   82 |             if value.trim().is_empty() {
   83 |                 return Err(DirectiveValidationError::EmptyField(name));
   84 |             }
   85 |         }
   86 |         if self.safe_argv.is_empty() {
   87 |             return Err(DirectiveValidationError::EmptySafeArgv);
   88 |         }
   89 |         if self.safe_argv[0] != "bwrk" {
   90 |             return Err(DirectiveValidationError::UnsafeSafeArg);
   91 |         }
   92 |         if !self.safe_argv.iter().any(|arg| *arg == "--json") {
   93 |             return Err(DirectiveValidationError::MissingJsonFlag);
   94 |         }
   95 |         if self.safe_argv.iter().any(|arg| !is_safe_arg(arg)) {
   96 |             return Err(DirectiveValidationError::UnsafeSafeArg);
   97 |         }
   98 |         if !SAFE_RUNNERS.contains(&self.runner) {
   99 |             return Err(DirectiveValidationError::UnsupportedRunner);
  100 |         }
  101 |         if self.shell {
  102 |             return Err(DirectiveValidationError::ShellExecution);
  103 |         }
  104 |         if self.action_required != self.severity.requires_action() {
  105 |             return Err(DirectiveValidationError::InconsistentSeverity);
  106 |         }
  107 |         Ok(())
  108 |     }
  109 | }
  110 | 
  111 | fn is_safe_arg(argument: &str) -> bool {
  112 |     if argument.is_empty() || argument.contains('\0') {
  113 |         return false;
  114 |     }
  115 |     if argument.starts_with('<') && argument.ends_with('>') {
  116 |         return argument[1..argument.len() - 1]
  117 |             .chars()
  118 |             .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
  119 |     }
  120 |     !argument.chars().any(is_shell_metacharacter)
  121 | }
  122 | 
  123 | const fn is_shell_metacharacter(character: char) -> bool {
  124 |     matches!(
  125 |         character,
  126 |         ';' | '|' | '&' | '$' | '`' | '\n' | '\r' | '<' | '>'
  127 |     )
  128 | }
  129 | 
  130 | pub fn guide(context: GuidanceContext<'_>) -> Directive {
  131 |     if !context.has_goal {
  132 |         return Directive {
  133 |             registry_id: "guidance.no_goal",
  134 |             version: "1",
  135 |             explanation: "create or select a project goal before mutating work",
  136 |             safe_argv: &["bwrk", "init", "<project>", "--json"],
  137 |             severity: DirectiveSeverity::Required,
  138 |             action_required: true,
  139 |             runner: "boreal_cli",
  140 |             shell: false,
  141 |         };
  142 |     }
  143 |     match context.status {
  144 |         DerivedStatus::Queued => Directive {
  145 |             registry_id: "guidance.wait_prerequisite",
  146 |             version: "1",
  147 |             explanation: "wait for the close-only prerequisite",
  148 |             safe_argv: &["bwrk", "status", "<project>", "--json"],
  149 |             severity: DirectiveSeverity::Advisory,
  150 |             action_required: false,
  151 |             runner: "boreal_cli",
  152 |             shell: false,
  153 |         },
  154 |         DerivedStatus::Blocked | DerivedStatus::Paused => Directive {
  155 |             registry_id: "guidance.resolve_hold",
  156 |             version: "1",
  157 |             explanation: "resolve the operator hold before claiming",
  158 |             safe_argv: &["bwrk", "status", "<project>", "--json"],
  159 |             severity: DirectiveSeverity::Blocking,
  160 |             action_required: true,
  161 |             runner: "boreal_cli",
  162 |             shell: false,
  163 |         },
  164 |         DerivedStatus::ExpiredReview => Directive {
  165 |             registry_id: "guidance.review_expiry",
  166 |             version: "1",
  167 |             explanation: "review the expired attempt before redispatch",
  168 |             safe_argv: &["bwrk", "status", "<project>", "--json"],
  169 |             severity: DirectiveSeverity::Blocking,
  170 |             action_required: true,
  171 |             runner: "boreal_cli",
  172 |             shell: false,
  173 |         },
  174 |         DerivedStatus::Ready => Directive {
  175 |             registry_id: "guidance.claim",
  176 |             version: "1",
  177 |             explanation: "claim the eligible work with a fenced attempt",
  178 |             safe_argv: &["bwrk", "work", "claim", "<project>", "<work>", "--json"],
  179 |             severity: DirectiveSeverity::Required,
  180 |             action_required: true,
  181 |             runner: "boreal_cli",
  182 |             shell: false,
  183 |         },
  184 |         DerivedStatus::Closed | DerivedStatus::Cancelled => Directive {
  185 |             registry_id: "guidance.inspect",
  186 |             version: "1",
  187 |             explanation: "inspect the terminal work history",
  188 |             safe_argv: &["bwrk", "work", "show", "<project>", "<work>", "--json"],
  189 |             severity: DirectiveSeverity::Advisory,
  190 |             action_required: false,
  191 |             runner: "boreal_cli",
  192 |             shell: false,
  193 |         },
  194 |         _ => Directive {
  195 |             registry_id: "guidance.inspect",
  196 |             version: "1",
  197 |             explanation: "inspect the current attempt and required gates",
  198 |             safe_argv: &["bwrk", "status", "<project>", "--json"],
  199 |             severity: DirectiveSeverity::Required,
  200 |             action_required: true,
  201 |             runner: "boreal_cli",
  202 |             shell: false,
  203 |         },
  204 |     }
  205 | }
  206 | 
  207 | /// Select guidance and fail closed if its trusted action contract is invalid.
  208 | pub fn guide_checked(context: GuidanceContext<'_>) -> Result<Directive, DirectiveValidationError> {
  209 |     let directive = guide(context);
  210 |     directive.validate()?;
  211 |     Ok(directive)
  212 | }
  213 | 
  214 | #[cfg(test)]
  215 | mod tests {
  216 |     use super::*;
  217 |     #[test]
  218 |     fn guidance_is_trusted_and_status_specific() {
  219 |         let no_goal = guide(GuidanceContext {
  220 |             work_id: "w",
  221 |             status: DerivedStatus::Ready,
  222 |             reason_codes: &[],
  223 |             has_goal: false,
  224 |         });
  225 |         assert_eq!(no_goal.registry_id, "guidance.no_goal");
  226 |         assert_eq!(no_goal.severity, DirectiveSeverity::Required);
  227 |         assert!(no_goal.action_required);
  228 |         let blocked = guide(GuidanceContext {
  229 |             work_id: "w",
  230 |             status: DerivedStatus::Blocked,
  231 |             reason_codes: &[],
  232 |             has_goal: true,
  233 |         });
  234 |         assert_eq!(blocked.registry_id, "guidance.resolve_hold");
  235 |         let discovery = guide(GuidanceContext {
  236 |             work_id: "w",
  237 |             status: DerivedStatus::Queued,
  238 |             reason_codes: &[],
  239 |             has_goal: true,
  240 |         });
  241 |         assert_eq!(discovery.severity, DirectiveSeverity::Advisory);
  242 |         assert!(!discovery.action_required);
  243 |         assert!(blocked.safe_argv.iter().all(|arg| !arg.contains(";")));
  244 |         assert!(guide_checked(GuidanceContext {
  245 |             work_id: "w",
  246 |             status: DerivedStatus::Ready,
  247 |             reason_codes: &[],
  248 |             has_goal: true,
  249 |         })
  250 |         .is_ok());
  251 |     }
  252 | 
  253 |     #[test]
  254 |     fn unfamiliar_harness_must_honor_required_action_boundary() {
  255 |         let directive = guide_checked(GuidanceContext {
  256 |             work_id: "unknown-to-harness",
  257 |             status: DerivedStatus::Ready,
  258 |             reason_codes: &[],
  259 |             has_goal: false,
  260 |         })
````
