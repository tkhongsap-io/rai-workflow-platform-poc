# Specification

Done when:

1. Every Thai string for the state uses "การตรวจทานในระบบเสร็จสิ้น":
   - the status badge (`status.ready_for_launch`: case page, My cases, queue);
   - the queue and operator values (`queue.next.review_complete` and `operator.value.ready_for_launch`, which already used it);
   - the next action (`next_action.ready_for_launch`);
   - the decided-Ready message (`review.decided.ready`);
   - the stale-version guidance (`error.stale_version.guidance.ready`);
   - the Ready mail subject and body (`mail.ready_for_launch`, `mail.ready_for_launch.body`).
2. No Thai string keeps "การตรวจสอบของโต๊ะเสร็จสิ้น" or names the state in English. The Thai mail's "(Ready for launch)" suffix is dropped so that the mail reads like the badge. English is unchanged.
3. Tests: a unit test pins items 1 and 2 and the unchanged English. It failed first. The browser suite, which runs axe at three widths, stays green in th and en; its assertions read locale keys, so they follow the new text.
4. Dated records (the walkthrough script and notes) that quote the old wording stay as written.
