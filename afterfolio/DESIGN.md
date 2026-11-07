# Young Planner — Calm Finance Editorial

> Reference: Ramp design system, via Refero Styles. Adapted for retirement planning, Korean copy, and older adults. This is a project design guide, not a pixel-perfect copy of Ramp.

Source: https://styles.refero.design/style/b38702a0-75ab-474c-9106-00b624535825

## Design intent

Make long-range household finance feel understandable, steady, and human. The interface should read like a clear retirement-planning report on warm paper: calm surfaces, strong numeric hierarchy, generous spacing, and restrained color. Every screen should help a first-time visitor answer: what is my situation, what changed, and what should I look at next?

## Visual foundations

- **Canvas:** warm ivory `#F6F5EE`.
- **Card surface:** soft white `#FFFEFA`.
- **Primary ink:** deep green-charcoal `#243A32`.
- **Primary action and selected plan:** evergreen `#17654C`.
- **Quiet surface:** pale sage `#EDF3EC`.
- **Muted text:** `#65766D`.
- **Hairline border:** `#DCE4DC`.
- **Reserve threshold / attention:** muted ochre `#B27A28`; use red `#A04032` only for depletion or errors.
- Keep the palette limited. Color must never be the only way to tell states apart; pair it with labels, icons, line patterns, or values.

## Typography and accessibility

- Use Noto Sans KR for Korean text and numerals. Use weight and size for hierarchy rather than decorative typefaces.
- Body copy: 16px minimum on desktop and mobile, line height 1.55 or greater. Important explanations may use 18px.
- Page headline: 32–40px desktop; 26–30px mobile. Section heading: 22–26px. Metric values: 30–40px, tabular numerals where supported. Labels and helper text: 14px minimum.
- Preserve clear Korean wording. Explain finance terms in everyday language at first use.
- Buttons and inputs should be at least 48px tall. Show a visible keyboard focus ring and keep text/background contrast strong.

## Layout and components

- Use a 4px spacing base with a practical rhythm of 8, 12, 16, 24, 32, and 48px. Give dense data room to breathe.
- Use 12–16px card corners, 8–10px input corners, and 8px buttons. Prefer 1px borders and gentle surface changes over heavy shadows.
- Keep the main flow obvious: household inputs → diagnosis → plan comparison → assumptions and evidence. At narrow widths, stack the content and keep primary actions reachable.
- Group optional or advanced inputs in clearly named disclosure sections. Keep the section label, current value, and expanded/collapsed state visible.
- Use tabs only for sibling analysis views such as “결과 비교”, “은퇴 계획”, and “가정과 근거”. Show one selected state clearly and preserve a visible keyboard focus state.
- Give the main result priority over settings and chat. Key result cards should show the time basis and unit beside each number.
- Distinguish “비상자금 기준 미달” from “자산 소진” with separate text, symbols, and line styles as well as color.

## Charts and money figures

- State whether a chart shows nominal amounts or 2026 purchasing power. Put units on axes and values in labels or tooltips.
- Keep before-plan, selected-plan, reserve-threshold, and depletion states visually distinct. Use a dashed ochre reserve line and a solid green selected-plan line; add direct labels when space allows.
- Prioritize the first shortage date, minimum financial assets, reserve status, and ending financial assets. Never imply that AI generated or validated a calculation.
- Format displayed amounts to one decimal place where appropriate, while preserving calculation precision internally.

## Chat and interaction

- Treat the chatbot as an optional floating helper: persistent launcher, explicit close button, and a panel that does not obscure the most important result on desktop. On mobile, use a full-height sheet with a pinned composer.
- Keep the input area easy to find. Use concise suggested questions that do not dominate the conversation.
- Separate user messages, assistant explanations, loading, error, retry, apply, and undo states. A plan is applied only after the user explicitly applies it.
- Keep example loading separate from AI plan application. Never announce “AI 계획 적용 완료” when only a sample scenario was loaded.

## Source adaptation

Adapted from Ramp’s warm off-white canvas, hairline card borders, restrained action color, and editorial hierarchy for a finance dashboard. Ramp’s chartreuse accent and Latin typeface are not carried over: Young Planner uses evergreen and Noto Sans KR for a calmer Korean retirement-planning context.

Component references:

- Tabs: https://component.gallery/components/tabs/ — use tabs for sibling analysis views to reduce clutter, not for unrelated actions.
- Accordion: https://component.gallery/components/accordion/ — use disclosures for secondary inputs, with a concise, understandable summary while collapsed.
- Morningstar Tabs: https://design.morningstar.com/systems/product/components/tabs — investor-facing design-system reference for keeping analysis navigation clear and familiar.
