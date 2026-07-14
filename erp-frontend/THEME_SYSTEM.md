# 🎨 ERP ITSM — Charte Graphique (Design System)

> **Version :** 1.0  
> **Stack :** React + Vite + Tailwind CSS + Framer Motion  
> **Design System :** Material 3 (M3) + Bento 2026  
> **Thème :** Dark/Light via classe `.dark`

---

## 1. 🎯 Philosophie de Design

- **Moderne & Professionnel** — Interface de management IT, tons indigo/bleutés
- **Bento Grid 2026** — Cartes arrondies, ombres douces, hover subtils
- **Micro-interactions** — Framer Motion pour toutes les transitions (spring, stagger, layoutId)
- **Accessible** — Focus visible, `prefers-reduced-motion`, contraste WCAG AA

---

## 2. 🎨 Palette de Couleurs

### Mode Clair

| Rôle | Variable CSS | Valeur | Usage |
|------|-------------|--------|-------|
| **Primary** | `--color-primary` | `#4f46e5` | Actions, liens, actif |
| **Primary container** | `--color-primary-container` | `#e0e0ff` | Fond des indicateurs actifs |
| **On-primary** | `--color-on-primary` | `#ffffff` | Texte sur primary |
| **Secondary** | `--color-secondary` | `#006699` | Badges secondaires |
| **Tertiary** | `--color-tertiary` | `#b94700` | Statuts "pending", warnings |
| **Error** | `--color-error` | `#dc2626` | Erreurs, suppressions |
| **Background** | `--color-background` | `#f4f7ff` | Fond de page |
| **Surface** | `--color-surface` | `#f4f7ff` | Fond des cartes |
| **Surface container lowest** | `--color-surface-container-lowest` | `#ffffff` | Cartes bento |
| **On-surface** | `--color-on-surface` | `#070d19` | Texte principal |
| **On-surface-variant** | `--color-on-surface-variant` | `#4a5468` | Texte secondaire |
| **Outline** | `--color-outline` | `#717d96` | Bordures |
| **Outline variant** | `--color-outline-variant` | `rgba(0,0,0,0.08)` | Bordures subtiles |

### Mode Sombre — Deep Black Monochrome

| Rôle | Valeur |
|------|--------|
| **Primary** | `#fafafa` (blanc cassé) |
| **Background** | `#000000` (noir pur) |
| **Surface container lowest** | `#0a0a0a` |
| **Surface container** | `#1a1a1a` |
| **Surface container high** | `#222222` |
| **On-surface** | `#fafafa` |
| **On-surface-variant** | `#a1a1aa` |
| **Outline** | `#52525b` |
| **Outline variant** | `rgba(255,255,255,0.06)` |
| **Secondary** | `#d4d4d8` |
| **Tertiary** | `#a1a1aa` |
| **Error** | `#ef4444` (conservé) |

> ✅ **Aucune teinte bleue** — tous les fonds sont des noirs/gris neutres. Les accents sont en blanc/gris.

### Déclinaisons fonctionnelles

| Usage | Light | Dark |
|-------|-------|------|
| `text-primary` | `#4f46e5` | `#fafafa` |
| Boutons `.btn-gradient` | Dégradé indigo → texte blanc | Dégradé blanc → texte noir |
| Logo `.logo-gradient` | Dégradé indigo triple | Dégradé blanc/gris triple |
| Progress `.progress-gradient` | Dégradé indigo | Dégradé blanc/gris |
| `bg-error/10` | Fond rouge transparent | Fond rouge transparent (inchangé) |
| `bg-emerald-500/10` | Badge "solved"/"basse" | Badge "solved"/"basse" (inchangé) |

---

## 3. 🔤 Typographie

### Police principale : **Gilmer** (self-hosted)

| Variant | Fichier |
|---------|---------|
| Light 300 | `Gilmer-Light.woff2` |
| Regular 400 | `Gilmer-Regular.woff2` |
| Medium 500 | `Gilmer-Medium.woff2` |
| Bold 700 | `Gilmer-Bold.woff2` |
| Heavy 800 | `Gilmer-Heavy.woff2` |

### Police monospace : **JetBrains Mono**
Utilisée pour les IDs, code, données techniques.

### Échelle typographique

| Token | Taille | Line-height | Letter-spacing | Weight | Usage |
|-------|--------|-------------|----------------|--------|-------|
| `font-display-lg text-display-lg` | 36px | 44px | -0.02em | 700 | Titres de page (Dashboard, Tickets…) |
| `font-headline-lg text-headline-lg` | 24px | 32px | -0.01em | 500 | Titres de section |
| `font-headline-md text-headline-md` | 20px | 28px | — | 500 | Sous-titres, titres de carte |
| `font-headline-sm text-headline-sm` | 16px | 24px | — | 500 | Titres de carte |
| `font-body-lg text-body-lg` | 16px | 24px | — | 400 | Descriptions |
| `font-body-md text-body-md` | 14px | 20px | — | 400 | Corps de texte |
| `font-body-sm text-body-sm` | 13px | 18px | — | 400 | Texte secondaire |
| `font-label-md text-label-md` | 12px | 16px | 0.05em | 500 | Labels, badges, uppercase |
| `font-mono-sm text-mono-sm` | 13px | 18px | — | 400 | IDs, code |

### Règles d'usage
- ✅ Toujours utiliser les tokens `font-* text-*` — pas de valeurs arbitraires (`text-[14px]`)
- ✅ Hiérarchie stricte : `display-lg` → `headline-lg` → `headline-md` → `body-md`
- ❌ Ne pas utiliser `font-semibold text-sm` à la place des tokens

---

## 4. 📐 Espacements

| Token | Valeur | Usage |
|-------|--------|-------|
| `xs` | 0.25rem (4px) | Petits écarts entre éléments |
| `sm` | 0.5rem (8px) | Gaps, padding petits |
| `md` | 1rem (16px) | Padding standard, gaps |
| `lg` | 1.5rem (24px) | Padding large, sections |
| `xl` | 2rem (32px) | Marges de conteneur |
| `container-margin` | 2rem (32px) | Marge du contenu principal |
| `gutter` | 1.5rem (24px) | Gouttière entre colonnes |

---

## 5. 🧱 Composants

### Bento Cards

```html
<div class="bento-card">
  <div class="bento-card-header">
    <h3 class="font-headline-md">Titre</h3>
  </div>
  <div class="bento-card-body">
    <!-- Contenu -->
  </div>
</div>
```

| Propriété | Valeur |
|-----------|--------|
| Background | `--color-surface-container-lowest` |
| Border | `1px solid var(--color-outline-variant)` |
| Border-radius | `1rem` |
| Hover | `translateY(-2px)` + glow sur bordure |
| Shadow | Double couche (bordure + ombre douce) |

### Bento Grid

```html
<div class="bento-grid">
  <div class="bento-col-2"> <!-- span 2 colonnes --></div>
  <div class="bento-col-1"> <!-- span 1 colonne --></div>
</div>
```

| Classe | Colonnes |
|--------|----------|
| `bento-col-1` | 1 (par défaut) |
| `bento-col-2` | 2 |
| `bento-col-3` | 3 |
| `bento-col-4` | 4 |

Responsive : 4 → 2 (≤1024px) → 1 (≤640px)

### Badges Statuts

```html
<span class="badge badge-status-new">NEW</span>
```

| Classe | Usage |
|--------|-------|
| `badge-status-new` | Nouveau (primary) |
| `badge-status-open` | Ouvert (secondary) |
| `badge-status-pending` | En attente (tertiary) |
| `badge-status-solved` | Résolu (emerald) |
| `badge-status-closed` | Fermé (slate) |

### Badges Priorités

```html
<span class="badge badge-priority-p1">Critique</span>
```

| Classe | Usage |
|--------|-------|
| `badge-priority-p1` | Critique (error) |
| `badge-priority-p2` | Haute (tertiary) |
| `badge-priority-p3` | Moyenne (secondary) |
| `badge-priority-p4` | Basse (emerald) |

### ConfirmDialog

Composant porté dans `document.body` via `createPortal`. Props :

| Prop | Type | Défaut |
|------|------|--------|
| `open` | boolean | false |
| `title` | string | "Confirmer" |
| `message` | string | — |
| `confirmLabel` | string | "Confirmer" |
| `cancelLabel` | string | "Annuler" |
| `danger` | boolean | false |
| `loading` | boolean | false |
| `onConfirm` | function | — |
| `onCancel` | function | — |

### Sidebar

- Largeur fixe : `w-64` (256px)
- Background : `bg-surface-container-lowest` avec bordure droite
- Navigation : `NavLink` avec `layoutId="nav-active-pill"` + `layoutId="nav-active-edge"`
- Footer : Carte utilisateur + boutons Thème/Déconnexion

---

## 6. ✨ Animations

### Principes
- **Durée micro-interactions** : 150-300ms
- **Easing** : `cubic-bezier(0.16, 1, 0.3, 1)` (personnalisé)
- **Spring** : `type: 'spring', stiffness: 380, damping: 36`
- **Stagger** : 0.04s entre les enfants

### Keyframes Tailwind

| Nom | Propriété |
|-----|-----------|
| `fade-in` | `opacity 0→1, translateY 4→0` |
| `fade-in-up` | `opacity 0→1, translateY 12→0` |
| `scale-in` | `opacity 0→1, scale 0.95→1` |
| `slide-in-right` | `opacity 0→1, translateX 8→0` |
| `pulse-soft` | `opacity 1→0.7→1` (2s) |

### Transitions CSS
```css
transition-property: background-color, border-color, color, fill, stroke, box-shadow;
transition-duration: 250ms;
```
→ `transform` et `opacity` exclus pour éviter les flashs au chargement.

---

## 7. 🖼️ Icônes

- **Set** : Material Symbols Outlined (Google Fonts)
- **Syntaxe** : `<span class="material-symbols-outlined">icon_name</span>`
- **Taille standard** : 24x24px (défaut)
- **FILL** : `fontVariationSettings: "'FILL' 0"` (outline) / `"'FILL' 1"` (filled)
- **État actif** : `FILL 1` pour les icônes de navigation active

---

## 8. 📱 Responsive

| Breakpoint | Largeur | Comportement |
|------------|---------|-------------|
| Mobile | < 640px | 1 colonne, sidebar masquée |
| Tablet | 640-1024px | 2 colonnes bento |
| Desktop | 1024-1440px | 3-4 colonnes bento |
| Wide | > 1440px | 4 colonnes |

- Sidebar : `fixed left-0 w-64` (prévoir toggle hamburger mobile)
- Tableaux : `overflow-x-auto` avec `min-w-[900px]`
- Modales : `max-w-3xl` (768px) ou `max-w-5xl` (1280px)

---

## 9. ♿ Accessibilité

- **Focus visible** : `outline: 2px solid var(--color-primary)` via `:focus-visible`
- **Curseur** : `cursor: pointer` global sur tous les éléments interactifs
- **Reduced motion** : `prefers-reduced-motion: reduce` → animations désactivées
- **Formulaires** : Labels avec `FieldRow` / `SelectRow`
- **Boutons icon-only** : Toujours un `aria-label`
- **Contraste minimum** : 4.5:1 pour le texte normal (AA)

---

## 10. 📁 Structure des Fichiers

```
erp-frontend/
├── tailwind.config.js      → Tokens de design (couleurs, fonts, espacements)
├── postcss.config.js       → Config PostCSS
├── components.json         → Config Shadcn/ui
├── THEME_SYSTEM.md         → Ce fichier (charte graphique)
└── src/
    ├── index.css           → Variables CSS M3 + composants globaux
    ├── context/
    │   └── ThemeContext.jsx → Gestion dark/light mode
    └── components/
        ├── ConfirmDialog.jsx   → Dialogue de confirmation
        ├── Skeleton.jsx        → Skeleton loader
        ├── EmptyState.jsx      → État vide
        ├── ErrorBoundary.jsx   → Boundary d'erreur
        └── ...                 → Autres composants
```

---

## 11. 📝 Conventions d'écriture

### Composants React
- **Fonctions** : `export default function ComponentName()`
- **État** : `useState`, `useEffect`
- **Animation** : Framer Motion via `motion.div`, `AnimatePresence`
- **Styles** : Tailwind CSS uniquement (pas de CSS modules, pas de styled-components)

### CSS
- **Variables** : `--color-*` pour M3
- **Composants** : Classes `.bento-*`, `.badge-*`, `.stat-card-*`
- **Pas de !important** sauf pour `prefers-reduced-motion`

### Nommage
- `camelCase` pour les fonctions/ variables JS
- `kebab-case` pour les classes CSS
- `UPPER_SNAKE_CASE` pour les constantes
