use boreal_service::{NotificationHub, RevisionCursor, SubscriptionUpdate};

fn main() {
    let hub = NotificationHub::new(3).expect("positive capacity");
    hub.publish(4, ["work-b", "work-a", "work-b"])
        .expect("first publication");
    hub.publish(4, ["attempt-a", "work-a"])
        .expect("duplicate revision coalesces");

    let replay = hub.replay(RevisionCursor::new(3));
    assert_eq!(replay.notifications.len(), 1);
    assert_eq!(
        replay.notifications[0].affected_subjects(),
        &["attempt-a", "work-a", "work-b"]
    );

    let backwards = hub.publish(3, ["late"]);
    assert!(backwards.is_err(), "out-of-order publication must be rejected");

    hub.publish(5, ["work-c"]).expect("next revision");
    let mut subscription = hub.subscribe(RevisionCursor::new(4));
    assert!(matches!(
        subscription.poll(),
        SubscriptionUpdate::Notification(notification) if notification.revision() == 5
    ));

    println!(
        "{{\"coalesced_subjects\":[\"attempt-a\",\"work-a\",\"work-b\"],\"backwards_revision\":\"rejected\",\"next_revision\":5}}"
    );
}
