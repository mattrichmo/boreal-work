use std::process::ExitCode;

fn main() -> ExitCode {
    match boreal_mcp::run_cli(&std::env::args().skip(1).collect::<Vec<_>>(), "boreal-mcp") {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("boreal-mcp: {error}");
            ExitCode::FAILURE
        }
    }
}
