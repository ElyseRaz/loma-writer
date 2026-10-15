---
name: Fluent Desktop Word Processor
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#434655'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0ef'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#585f67'
  on-secondary: '#ffffff'
  secondary-container: '#dce3ec'
  on-secondary-container: '#5e656d'
  tertiary: '#525558'
  on-tertiary: '#ffffff'
  tertiary-container: '#6a6d71'
  on-tertiary-container: '#eef0f4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dce3ec'
  secondary-fixed-dim: '#c0c7d0'
  on-secondary-fixed: '#151c23'
  on-secondary-fixed-variant: '#40484f'
  tertiary-fixed: '#e0e2e6'
  tertiary-fixed-dim: '#c4c7ca'
  on-tertiary-fixed: '#191c1f'
  on-tertiary-fixed-variant: '#44474a'
  background: '#fcf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e1'
typography:
  title-window:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0px
  ribbon-tab:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  toolbar-button:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0px
  ruler-number:
    fontFamily: Inter
    fontSize: 9px
    fontWeight: '400'
    lineHeight: 10px
    letterSpacing: 0.02em
  document-display:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  document-h1:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  document-h2:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  document-h3:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-ui:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0px
  body-document:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0px
  status-label:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0px
  kbd-shortcut:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system defines the interface for an elegant, desktop-grade word processing environment built specifically for productivity-focused environments on modern Linux platforms. Drawing inspiration from modern desktop paradigms—notably the structured discipline of Microsoft Windows 11 Fluent Design—the aesthetic reconciles structural familiarity with the lightweight, focused ethos of Unix desktops.

The core visual style is **Corporate / Modern** layered with subtle desktop tactile cues:
- **Atmospheric Neutrality:** A calm desktop canvas creates spatial separation without visual noise, letting the document canvas remain the primary focal point.
- **Micro-Structured Hierarchy:** Interfaces rely on horizontal ribbons, precision toolbars, native window chrome, and persistent document metrics rather than hidden swipe or gesture paradigms.
- **Clarity over Ornamentation:** Visual density is optimized for pointer and keyboard-driven workflows. Transparency and diffuse blurs are reserved strictly for non-document chrome, keeping text rendering crisp and legible.

## Colors

The palette balances quiet window framing with an authoritative, energetic royal blue accent.

- **Window Chrome & Canvas (`#F3F3F3`):** The primary outer envelope for the application shell, title bar, ruler track, and surrounding desktop canvas.
- **Pure Surfaces (`#FFFFFF`):** Reserved for elevated desktop panels, ribbon item dropdowns, modal sheets, and the central A4 editing canvas.
- **Primary Text (`#242424`):** A high-legibility near-black that softens optical glare during prolonged reading and editing sessions.
- **Secondary / Metadata Text (`#6B7280`):** Used for non-active tab labels, hotkey indicators, zoom levels, character counts, and status bar metrics.
- **Primary Accent (`#2563EB`):** Applied to active tab underlines, primary document actions, caret indicators, and active text-selection fills.
- **Soft Accent Fill (`#EFF6FF`):** Tint applied to active ribbon buttons, selected inline options, and hovered navigation items.
- **Structural Outlines (`#E5E7EB`):** Demarcates ribbon splits, ruler gradations, toolbar separators, and card boundaries with subtle single-pixel precision.

## Typography

Typography prioritizes functional density, crisp rasterization at sub-pixel levels, and platform compatibility. The type stack leverages **Inter** with fallbacks to system fonts (`Segoe UI`, `-apple-system`, `Ubuntu`, `sans-serif`) to ensure seamless execution on Linux desktops.

- **System & Window Chrome:** Renders between 11px and 13px at medium (`500`) weight, keeping interface elements compact and leaving vertical real estate for document authoring.
- **Toolbar & Ruler Scales:** Employs condensed sizes (9px–11px) with clean numerical baselines for exact physical unit representations (centimeters, inches).
- **Document Content Hierarchy:** Scaled strictly in relation to standard desktop publishing expectations: H1 through H3 use clear typographic steps with controlled line-heights to mirror print previews accurately on screen.

## Layout & Spacing

The application architecture utilizes a strict, non-collapsing vertical shell layout segmented into functional desktop bands:

1. **Title Bar Band (32px fixed height):** Contains the window identity, document file name with dirty/saved state, window drag region, and Linux-tailored minimize/maximize/close clusters.
2. **Ribbon & Command Shell (variable, default 104px):** A tabbed row (30px) followed by a grouped command toolbox (74px) organized into logical sections (*Fichier*, *Accueil*, *Insertion*, *Mise en page*).
3. **Precision Ruler Track (20px fixed height):** Positioned immediately above the viewport, aligning strictly with document margins.
4. **Interactive Document Workspace (flex auto-grow):** Horizontally centered viewport with minimum lateral padding of 32px on desktop displays.
5. **Status & Metric Strip (24px fixed height):** Pinned to the base edge with edge-to-edge metadata presentation.

The physical document operates on an exact A4 ratio (210mm x 297mm; nominally rendered at 794px × 1123px at 96 DPI baseline) with customizable print-margin insets.

## Elevation & Depth

Visual hierarchy adopts subtle ambient diffusion, distinguishing functional interactive tools from the physical page:

- **Level 0 (Desktop Background Canvas):** `#F3F3F3` matte flat surface. No shadow.
- **Level 1 (Ribbon & Chrome Panels):** `#FFFFFF` surfaces separated by a 1px solid border (`#E5E7EB`). Flat elevation with spatial separation defined solely through tonal borders.
- **Level 2 (Interactive Popovers, Toolbars, & Dropdowns):** Subtle diffuse desktop elevation:
  `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04);`
- **Level 3 (A4 Paper Surface):** Mimics physical stationary hovering over the desktop canvas:
  `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.08);`
- **Level 4 (System Dialogs & Modal Overlays):** Stronger elevation for modal focus:
  `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);`

## Shapes

The design system incorporates structured, moderate desktop geometry:

- **Outer Window Shell:** Soft 8px–10px corner radius conforming to Linux desktop window managers (e.g., GNOME/Mutter or modern Wayland compositors).
- **Interactive Controls (Buttons, Inputs, Toggles):** Strict 6px radius (`0.375rem`) providing a disciplined, professional Fluent-style profile.
- **Ribbon Command Clusters:** Groups of tools are contained inside 6px rounded panels with hair-line split boundaries.
- **Document Sheet:** Crisp 2px corner radius, balancing physical paper realism with digital clarity.
- **Chips, Badges, and Pill Indicators:** 4px to 6px radii; full pills are strictly reserved for document tag badges and status indicators.

## Components

### Title Bar & Window Controls
- **Geometry:** 32px height, spans 100% window width.
- **Elements:** App icon and document name centered or left-aligned; close/maximize/minimize buttons aligned right (or according to GTK system preference).
- **Window Controls:** Hover state `#E5E7EB`; close button hover `#DC2626` with `#FFFFFF` glyph.

### Fluent Ribbon & Tab Strip
- **Tabs:** 30px height, text in `ribbon-tab` typography. Active tab displays a 2px high `#2563EB` bottom indicator and `#FFFFFF` background flowing continuously into the ribbon body.
- **Command Groups:** Divided by 1px vertical borders (`#E5E7EB`). Each group contains small icon-only buttons (24x24px) or stacked icon-and-label buttons (up to 64px height).
- **Interactive State:** Hover produces `#F3F3F3` background; active/toggled state displays `#EFF6FF` background with `#2563EB` icon stroke.

### Precision Horizontal Ruler
- **Height & Track:** 20px height, background `#F3F3F3`, border bottom 1px `#E5E7EB`.
- **Ruler Body:** Active paper width represented in pure `#FFFFFF`; inactive margins in `#E5E7EB`.
- **Gradations:** 1mm and 5mm vertical ticks in `#9CA3AF`; text markers every 1cm or 1 inch using `ruler-number` typography.
- **Indentation Markers:** Draggable triangular pointers (First Line Indent, Left Indent, Right Indent) styled in `#2563EB` with precise 1px anchor stems.

### Document Canvas (A4 Paper)
- **Dimensions:** 794px width (standard A4 at 96 DPI scale), centered in canvas view with auto margins.
- **Surface:** Solid `#FFFFFF`, surrounded by Level 3 paper shadow.
- **Margins Overlay:** Subtle dashed guidelines rendered on hover or ruler drag, disappearing during normal drafting.

### Status Bar
- **Dimensions:** 24px fixed height at screen bottom, background `#FFFFFF`, border-top 1px `#E5E7EB`.
- **Items:** Page index, word count, character count, proofing language indicator, zoom slider with percentage button, and layout view switchers (Print Layout, Web Layout, Read Mode).

### Input Fields & Desktop Combos
- **Style:** 28px height, 1px border `#E5E7EB`, background `#FFFFFF`, 6px corner radius.
- **Focus:** 1.5px outline in `#2563EB` with subtle outer ring `rgba(37, 99, 235, 0.15)`.

### Checkboxes, Radio Buttons, & Toggles
- **Checkboxes & Radios:** 16px square/circle, `#E5E7EB` border. Checked state uses solid `#2563EB` fill with white indicator glyph.
- **Toggle Switches:** 36px wide by 20px high, 10px circular thumb.