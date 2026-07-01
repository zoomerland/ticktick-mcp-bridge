import { loadConfig } from "../src/config.mjs";
import { buildProactiveReview } from "../src/secretary/proactive.mjs";

const config = loadConfig({
  TELEGRAM_DRY_RUN: "true",
  TELEGRAM_ALLOWED_USER_IDS: "1001",
});

const review = buildProactiveReview({
  now: new Date("2026-06-24T14:00:00+03:00"),
  todayData: {
    tasks: [
      { title: "Pay overdue bill", dueBucket: "overdue", priority: 5, projectName: "Payments" },
      { title: "Write project note", dueBucket: "today", priority: 3, projectName: "Projects" },
    ],
  },
  inboxData: [
    { title: "Clarify doctor trip", projectName: "Inbox" },
  ],
}, config);

console.log(review.text);
console.log(JSON.stringify({ shouldNotify: review.shouldNotify, reasons: review.reasons }, null, 2));
