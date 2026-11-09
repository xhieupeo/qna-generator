# UI/UX Design System & Style Guide: `styles.md`

This document defines the complete UI/UX design rules, tokens, visual hierarchy, and component specifications for the **QnA Generator** application.

---

## 1. Core Design Philosophy

* **Aesthetic**: **Precision Technical / Modern Brutalist** — Sharp, architectural, reliable, and functional. An interface designed like an engineer's workbench or academic review studio.
* **Strict Law 1 — Zero Gradients**: No linear, radial, conic, or mesh gradients anywhere in the application. Every surface, button, background, and badge uses solid, flat colors with deliberate contrast.
* **Strict Law 2 — Zero Border Radius**: `border-radius: 0px` (`rounded-none`) across all elements without exception. No rounded corners on buttons, inputs, cards, dialogs, badges, progress bars, or image viewports.
* **Depth & Affordance**: Elevation and tactile clickability are achieved through **sharp borders (1px/2px)**, **hard offset shadows (`box-shadow: 2px 2px 0px #000` or `4px 4px 0px #000`)**, and distinct flat color inversion on hover/active states.

---

## 2. Color Palette (Solid Tokens Only)

### Neutral Base (Surfaces & Text)
| Token | Hex | Tailwind Equivalent | Purpose |
| :--- | :--- | :--- | :--- |
| `surface-bg` | `#F8FAFC` | `bg-slate-50` | App background (crisp canvas) |
| `surface-card` | `#FFFFFF` | `bg-white` | Question cards, modals, sidebars |
| `surface-subtle` | `#F1F5F9` | `bg-slate-100` | Secondary wells, code blocks, dropzones |
| `surface-dark` | `#0F172A` | `bg-slate-900` | Inverted surfaces, dark buttons, headers |
| `border-hairline` | `#E2E8F0` | `border-slate-200` | Subtle structural dividers |
| `border-hard` | `#0F172A` | `border-slate-900` | Focus outlines, active cards, emphasis |
| `text-primary` | `#0F172A` | `text-slate-900` | Question titles, primary labels |
| `text-secondary` | `#475569` | `text-slate-600` | Explanations, helper text, timestamps |
| `text-muted` | `#94A3B8` | `text-slate-400` | Placeholders, disabled states |

### Brand & Interactive Colors
| Token | Hex | Tailwind Equivalent | Purpose |
| :--- | :--- | :--- | :--- |
| `brand-primary` | `#2563EB` | `bg-blue-600` | Primary actions ("Generate", "Save to Supabase") |
| `brand-hover` | `#1D4ED8` | `hover:bg-blue-700` | Button hover state |
| `brand-surface` | `#EFF6FF` | `bg-blue-50` | Active selection, highlighted question |

### Semantic Status Tokens
| State | Solid Surface | Solid Border | Solid Text | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Correct / Success** | `#ECFDF5` (`emerald-50`) | `#059669` (`emerald-600`) | `#065F46` (`emerald-800`) | Correct MCQ option, successful save |
| **Incorrect / Error** | `#FEF2F2` (`red-50`) | `#DC2626` (`red-600`) | `#991B1B` (`red-800`) | Distractor in review, API failure |
| **Warning / Attention** | `#FFFBEB` (`amber-50`) | `#D97706` (`amber-600`) | `#92400E` (`amber-800`) | Missing answer alert, token warning |
| **Info / AI Processing** | `#F0FDF4` (`green-50`) / `#F0F9FF` (`sky-50`) | `#0284C7` (`sky-600`) | `#075985` (`sky-800`) | AI generation progress, metadata |

---

## 3. Typography & Hierarchy

* **Primary Sans-Serif**: `Inter`, `Geist Sans`, or system sans (`font-sans`) for general UI, navigation, options, and explanations.
* **Monospace Font**: `JetBrains Mono`, `Geist Mono`, or system monospace (`font-mono`) for question numbers (`[Q01]`), option badges (`[A]`, `[B]`), code blocks, LaTeX expressions, and metadata.

### Typographic Scale
* **Display / Hero**: `text-3xl font-bold tracking-tight text-slate-900` (e.g., Page Title)
* **Section Heading**: `text-xl font-bold tracking-tight text-slate-900` (e.g., "Review Questions")
* **Question Prompt**: `text-base font-semibold leading-relaxed text-slate-900`
* **Option Body**: `text-sm font-normal text-slate-800`
* **Explanation / Caption**: `text-xs leading-normal text-slate-600`
* **Technical Tags**: `text-xs font-mono font-medium tracking-wide uppercase`

---

## 4. Layout & Spacing Rules

* **Grid Base**: 4px / 8px spacing system (`p-2`, `p-4`, `p-6`, `gap-4`, `gap-6`).
* **Borders Over Shadows**: All container separation must use solid 1px or 2px borders (`border border-slate-200` or `border-2 border-slate-900`).
* **Optional Tactile Hard Shadow**: For primary floating cards or prominent buttons:
  ```css
  /* Hard drop shadow without blur or radius */
  box-shadow: 3px 3px 0px 0px #0F172A;
  ```
  *When pressed/active*:
  ```css
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0px 0px #0F172A;
  ```

---

## 5. Component Specifications (Strict No-Radius Rules)

### A. Buttons (`rounded-none`)
* **Primary Button**: Solid background (`bg-slate-900` or `bg-blue-600`), text white, `rounded-none`, `px-4 py-2 text-sm font-medium`, `border border-slate-900`. Hover: inverts color or darkens flat shade.
* **Secondary / Outline Button**: `bg-white text-slate-900 border border-slate-300 rounded-none hover:bg-slate-100 hover:border-slate-900`.
* **Danger Button**: `bg-white text-red-600 border border-red-300 rounded-none hover:bg-red-50 hover:border-red-600`.

### B. Input Fields & Dropzones (`rounded-none`)
* **Text / API Key Inputs**: `rounded-none border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900`.
* **Dropzone**: Rectangular dashed container (`border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-900 rounded-none`).

### C. Question Cards (`rounded-none`)
* Structure:
  * **Header**: Monospace tag badge `[Q01]`, topic tag, difficulty badge, and "Regenerate" / "Delete" buttons.
  * **Image Viewport**: Solid bordered rectangular box (`border border-slate-200 bg-slate-100 p-2`). Image is unrounded with clean aspect-ratio preservation.
  * **Question Text**: Clear, high-contrast, editable on click.
  * **Option Rows**: 4 full-width rectangular rows.
    * Inactive: `border border-slate-200 bg-white hover:bg-slate-50`.
    * Correct Option: `border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-medium`.
    * Option Tag: Monospace prefix box `[A]`, `[B]`, `[C]`, `[D]`.
  * **Explanation Accordion**: Solid flat background (`bg-slate-100 border-t border-slate-200 p-3`).

### D. Badges & Tags (`rounded-none`)
* Rectangular, sharp tags:
  * Default: `border border-slate-300 bg-slate-100 text-slate-700 px-2 py-0.5 text-xs font-mono rounded-none`
  * Easy: `border border-emerald-300 bg-emerald-50 text-emerald-800`
  * Medium: `border border-amber-300 bg-amber-50 text-amber-800`
  * Hard: `border border-red-300 bg-red-50 text-red-800`

### E. Progress Bars & Sliders (`rounded-none`)
* Outer track: `h-2 w-full bg-slate-200 border border-slate-300 rounded-none`
* Inner fill: `h-full bg-slate-900 transition-all rounded-none` (strictly solid flat color, no animated gradient shimmer).

---

## 6. Accessibility & State Rules

* **Keyboard Navigation**: Focus rings must be solid, high-contrast 2px outlines: `focus-visible:outline-2 focus-visible:outline-slate-900 focus-visible:outline-offset-1`.
* **Contrast Compliance**: All text combinations must exceed WCAG AA (4.5:1 for normal text, 3:1 for large text).
* **Loading & Thinking States**:
  * Use solid blinking cursor `_` or solid step-by-step progress checklists rather than soft blurred skeleton gradients.
* **Empty States**:
  * Clean boxed dashed containers with descriptive copy and clear primary call-to-action buttons.

