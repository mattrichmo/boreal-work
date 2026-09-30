//! Actor-specific discovery uses canonical conditional status, never raw lifecycle alone.
use crate::{project_status_from_store_for_session, StatusWork};
use boreal_domain::{ActorContext, ProjectId, Revision, TimestampMs};
use boreal_store::SqliteStore;

pub struct DiscoverySnapshot {
    pub revision: Revision,
    pub items: Vec<StatusWork>,
}

pub fn discover_work(
    store: &SqliteStore,
    project: &ProjectId,
    actor: &ActorContext,
    session: Option<&str>,
    as_of: TimestampMs,
) -> Result<DiscoverySnapshot, String> {
    let mut items = Vec::new();
    let mut offset = 0;
    let mut revision = None;
    loop {
        let page = project_status_from_store_for_session(
            store, project, actor, session, as_of, 1000, offset,
        )?;
        if revision.is_some_and(|r| r != page.project_revision) {
            return Err("project changed during discovery; refresh the query".into());
        }
        revision = Some(page.project_revision);
        let consumed = page.page_count;
        items.extend(page.items);
        offset += consumed;
        if offset >= page.total || consumed == 0 {
            break;
        }
    }
    items.sort_by(|a, b| {
        b.work
            .priority
            .cmp(&a.work.priority)
            .then_with(|| a.work.id.as_str().cmp(b.work.id.as_str()))
    });
    Ok(DiscoverySnapshot {
        revision: revision.unwrap_or(Revision(0)),
        items,
    })
}
