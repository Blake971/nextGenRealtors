# Tech Stack — Real Estate Agent Website

## Frontend

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| **Structure**| HTML5 (Semantic)                                        |
| **Styling**  | Vanilla CSS3 (CSS Variables, Grid, Flexbox, Animations) |
| **Logic**    | Vanilla JavaScript (ES6+) — no frameworks               |
| **Fonts**    | Google Fonts — *Playfair Display* + *Inter*             |

---

## Architecture

| Aspect            | Detail                                                       |
|-------------------|--------------------------------------------------------------|
| **App Type**      | Single Page Application (SPA)                                |
| **Routing**       | Hash-based (`#plots`, `#flats`, etc.) with `history.pushState` |
| **Data Storage**  | Firebase Firestore for listings, settings, and admin data    |
| **Image Storage** | Remote image URLs and uploaded media handled through Firebase / external services |

---

## Key Browser APIs Used

- **Firebase Firestore** — saves listings, reviews, admin session data, and visibility settings
- **`FileReader`** — converts local images to base64 for property photos and agent photo upload
- **`history.pushState`** — SPA navigation without page reloads
- **YouTube `<iframe>` embed** — property video tours in listing detail view

---

## Brand Colors

| Name                  | Hex       | Usage                                     |
|-----------------------|-----------|-------------------------------------------|
| Primary Brand Orange  | `#F37721` | Buttons, accents, price tags, highlights  |
| Corporate Navy        | `#0D2E4F` | Navbar, hero sections, footer, badges     |
| Text Gray             | `#4A4A4A` | All body text and headings                |
| Background            | `#F2F2F2` | Page background and form fields           |

---

## Project File Structure

```
TestProj/
├── index.html          # SPA shell — navigation, modals, script imports
├── css/
│   └── style.css       # Complete design system (~1800 lines, CSS variables)
├── js/
│   ├── data.js         # localStorage CRUD helpers + seeded sample data
│   ├── admin.js        # Admin auth, property forms, image upload helpers
│   └── app.js          # Router, page renderers, modal & toast utilities
├── agent.png           # Default agent profile photo (replaceable via UI)
└── Tech Stack.md       # This file
```

---

## Admin Features

- Password-protected admin login (stored in `sessionStorage`)
- Add / Edit / Delete property listings (Plots, Flats, Villas)
- Upload up to 4 property photos per listing (local file → base64)
- Add YouTube video link for property tour embed
- Delete customer reviews
- Upload agent profile photo from local device (About Me page)
- Custom confirmation modals (no native browser `confirm()` dialogs)

---

## What is NOT Used

- ❌ No Node.js / npm / package manager
- ❌ No React, Vue, Angular, or any JS framework
- ✅ Node.js / Express backend for SMS and social publishing proxy
- ✅ Firebase Firestore database
- ❌ No build tools (Webpack, Vite, Parcel, etc.)
- ❌ No internet connection required (except Google Fonts & YouTube embeds)

> **The entire site runs directly from the file system.**  
> Just open `index.html` in any modern browser — nothing to install or deploy.
