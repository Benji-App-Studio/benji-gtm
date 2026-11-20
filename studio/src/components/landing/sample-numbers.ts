// The landing page's sample cards (previews.tsx) show the example app's numbers: Trailmix, the hike
// planner of components/preview/sample-world.ts, over the last 28 days. Kept as plain values so the landing
// page doesn't load the sample world; components/preview/sample-world.test.ts checks they still match it.
export const LANDING_SAMPLE = {
  /** Spend ÷ paying customers attributed by AppStack (Home's and Measure's CAC). */
  cac: 19.05,
  /** RevenueCat's realized 30-day LTV per paying customer. */
  ltv: 38.6,
  ltvCac: 2.0,
  paybackMonth: 1,
  /** The testing ad set's daily budget (the Launch card, sending its three creatives). */
  dailyBudget: 30,
  /** Testing and scaling budgets together: the line on the spend chart. */
  budgetPerDay: 70,
  /** Spend per day over the last 14 days, in dollars (the scaling campaign starts 8 days ago). */
  spendPerDay: [26, 31, 31, 30, 30, 74, 73, 72, 70, 68, 67, 66, 66, 67],
  /** What each kind of campaign costs per customer, and what's left of the LTV. */
  testingCost: 12.92,
  scalingCost: 6.13,
  margin: 19.55,
};
