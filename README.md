# Dashboard Shutdown 23 Nov 2026 – Pelletizing · Kiln · Calcine Transfer Car

Dashboard web untuk memantau shutdown: pekerjaan per area, cek equipment sebelum running,
putaran kiln per jam (auxiliary), dan temperatur kiln (T1/T2) per jam.

- **Website**: `https://<owner>.github.io/<repo>/` (GitHub Pages dari branch `main`)
- **Data**: file JSON di branch `data` → folder `data/`
- **Riwayat**: setiap perubahan dari dashboard = 1 commit di branch `data`, lengkap dengan nama
  akun GitHub yang mengubah (lihat tab *Commits* branch `data`).

## Siapa bisa apa

| | Tanpa login | Login editor |
|---|---|---|
| Lihat dashboard | ✅ (data bisa telat ±5 menit) | ✅ (refresh tiap 30 detik) |
| Input / ubah data | ❌ | ✅ |

> Repo ini **public**: siapa pun yang tahu link bisa melihat dashboard dan data di repo.

## Setup sekali (pemilik repo)

1. **GitHub Pages**: *Settings → Pages → Build and deployment* → Source **Deploy from a branch**,
   Branch **main**, folder **/(root)** → Save. Tunggu ±1 menit, link website muncul di halaman itu.
2. **Tambah editor**: *Settings → Collaborators → Add people* → masukkan akun GitHub tiap SPV/editor.
   Mereka harus menerima undangan dari email/notifikasi GitHub.

## Login editor (tiap orang yang input)

1. Punya akun GitHub dan sudah diterima sebagai collaborator repo ini.
2. Buat token: <https://github.com/settings/personal-access-tokens/new>
   - **Resource owner**: pemilik repo · **Repository access**: *Only select repositories* → repo ini
   - **Permissions → Repository permissions → Contents**: **Read and write**
   - Expiration: secukupnya (mis. 30 hari) → **Generate token** → salin (`github_pat_…`).
   - Bila resource owner adalah akun orang lain dan repo tidak muncul, pakai *Tokens (classic)* dengan scope `public_repo`.
3. Buka website → klik **🔑 Login editor** → tempel token → **Login**.
4. Token hanya tersimpan di browser itu. **Klik Logout** bila memakai PC bersama (control room).

## Struktur

```
main  : index.html · store.js (baca/tulis GitHub) · app.js (tampilan & logika) · README.md
data  : data/tasks.json · checks.json · rotations.json · temps.json · settings.json
```

- Ubah daftar pekerjaan / item cek besar-besaran: edit `data/tasks.json` atau `data/checks.json`
  langsung di branch `data` (format JSON), atau minta bantuan.
- Bila website tidak di `owner.github.io/repo`, isi `window.DASH_CONFIG` di `index.html`.

## Aturan utama yang dihitung otomatis

- Kiln boleh running bila semua pekerjaan **Selesai** dan semua cek equipment **OK**.
- P1 feed bin furnace ≥ 250 t · P2 PC bin ≤ 0 t · P3 dry ore bin < 9,5 m · P4 dry ore bin backup > 14 m (sebelum stop feeding 04:00).
- BC#7 (pekerjaan & cek) boleh dilewatkan untuk heating up bila P4 sudah Selesai.
- Putaran kiln aux wajib 1× per jam (SPV Operation).
- Temperatur: kondisi chunk dipilih sekali (ada chunk → T2, tidak → T1). Target pendinginan
  = nilai jam mulai pendinginan − 20 °C/jam; heating sesuai tahapan di tab Setting.
