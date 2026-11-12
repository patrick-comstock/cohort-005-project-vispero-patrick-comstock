---
status: accepted
---

# Notifications store a snapshot of what they said

A Notification records what one person was told at the moment something happened. So when it is created it stores its finished content: a kind (such as "Refund Request made" or "Refund Request Resolved"), a one-line headline, an optional body (which carries the Resolution Note when there is one), and a link to its subject. It also stores who it is for, when it was created, and when it was read. It is never re-rendered from the current state of the thing it is about. It is written in the same transaction as the event that causes it, one per recipient, so a Notification never exists without its event. This was decided in the wayfinder ticket "Store a Notification's content as a snapshot or derive it on render?" (issue #48) of the In-app Notifications map (issue #43).

## Considered Options

- **Derive on render (rejected).** The Notification would store only a kind and a reference to its subject (for example a Refund Request), and its text would be built from current data each time the list is shown. The text would never go stale, and nothing in the app is ever deleted, so the reference would always resolve. But every new kind would need its own rendering code and joins, and an old Notification would quietly change, for example after an Instructor renamed a course, so it would no longer show what the person was actually told.

## Consequences

- A Notification can be out of date. It shows a course title or status as they were when it was sent, and this is intended.
- Adding a new kind of Notification needs only code that writes its content when the event happens. The list page renders every kind the same way.
- A Notification does not store a reference to its subject, so it can't yet be marked read when its subject is opened, or found by subject. Add a subject reference if either is needed.
- Changing the wording of a kind affects only Notifications created after the change.
