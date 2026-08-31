# Dasar Privasi — ft-Transcendence (RetroLudo '42)

**Tarikh berkuat kuasa:** 2026-08-26
**Penguasa:** Team Pace 24, pembangawa ft-Transcendence (RetroLudo '42) (kami, "Tim")

Dasar Privasi ini menjelaskan bagaimana aplikasi web ft-Transcendence (RetroLudo '42) ("Apl", "kami", "kami") mengumpulkan, menggunakan, menggenapi, dan melindungi data peribadi anda. Ia disediakan mengikut **Akta Perlindungan Data Peribadi Malaysia 2010 ("PDPA")** dan prinsip-prinsip panduannya: Umum, Notis dan Pilihan, Penggenapan, Keselamatan, Penyimpanan, Integriti Data, dan Akses.

---

## 1. Apakah data peribadi yang kami kumpulkan

Apl ini hanya mengumpulkan data yang diperlukan untuk menyediakan permainan dan ciri-ciri akaun:

| Kategori | Data | Sumber |
|---|---|---|
| Pengenal akaun | nama pengguna, nama paparan, alamat e-mel | anda sediakan semasa pendaftaran |
| Pengesahan | kata laluan (disimpan hanya sebagai hash bcrypt — tidak pernah plaintext) | anda sediakan |
| Pengenal OAuth | nama pembekal dan ID akaun pembekal (Google, GitHub, atau 42) | pembekal OAuth, hanya jika anda memilih untuk melog masuk dengan cara ini |
| Profil | imej avatar suai (jika dimuat naik), gaya avatar lalai | anda sediakan |
| Aktiviti permainan | sejarah pertandingan, keputusan permainan, rating, statistik kemenangan/kerugian/rentetan | dijana oleh permainan anda |
| Sosial | senarai rakan, permintaan rakan, senarai blok, jemputan permainan | dijana oleh aktiviti anda dalam apl |
| Teknikal | kehadiran/status dalam talian, keutamaan notifikasi | dijana oleh penggunaan Apl |

Kami **tidak** mengumpulkan butiran kad pembayaran, data lokasi, atau sebarang data daripada kanak-kanak di bawah umur 13 tahun. Apl ini adalah permainan dan tidak melakukan profil automatik melebihi menampilkan statistik permainan yang anda sudah lihat.

---

## 2. Notis dan pilihan (persetujuan)

Dengan mencipta akaun dan menggunakan Apl, anda bersetuju dengan pengumpulan dan penggunaan data peribadi anda sebagaimana diterangkan dalam Dasar ini. Log masuk dengan pembekal luaran (Google, GitHub, 42) adalah pilihan dan hanya berlaku apabila anda memilih kaedah log masuk tersebut.

- Anda boleh menarik semula persetujuan dengan menghapuskan akaun anda pada bila-bila masa sahaja (lihat Bahagian 7).
- Di mana data pilihan terlibat (cth., memuat naik avatar, menghubungkan kaedah OAuth), data tersebut hanya dikumpulkan berdasarkan pilihan anda yang jelas.

---

## 3. Bagaimana kami menggunakan data anda

Kami menggunakan data peribadi anda semata-mata untuk:

- Mencipta dan menguruskan akaun anda
- Mengesahkan identiti anda (e-mel/kata laluan atau OAuth)
- Menjalankan pertandingan, merekodkan keputusan, dan mengekalkan jadual pemimpin dan statistik
- Menguruskan rakan, notifikasi, dan status kehadiran
- Memverifikasi alamat e-mel anda dan mengamankan akaun anda (pengesahan dua faktor)
- Menjawab permintaan anda dan menyediakan sokongan

Kami **tidak** menjual, menyewa, atau menukar data peribadi anda, dan kami tidak menggunakannya untuk pemasaran atau pengiklanan.

---

## 4. Penggenapan

Data anda hanya dikongsikan sejumlah yang diperlukan untuk mengoperasikan Apl:

- **Di dalam Apl**: keputusan permainan, nama pengguna, dan kehadiran ditunjukkan kepada pemain lain sebagai sebahagian daripada permainan (cth., jadual pemimpin, senarai rakan, sejarah pertandingan). **Alamat e-mel dan kata laluan anda tidak pernah ditunjukkan kepada pemain lain.**
- **Penyedia perkhidmatan**: Apl ini berjalan pada infrastruktur sendiri yang dihoskan (bekas Docker) dan menggunakan pembekal OAuth pihak ketiga (Google, GitHub, 42) serta perkhidmatan e-mel semata-mata untuk menyampaikan ciri yang anda gunakan.
- **Pematuhan undang-undang**: kami mungkin mencelupkan data jika diperlukan oleh undang-undang atau pihak berkuasa yang kompeten.

Kami tidak memindahkan data peribadi anda di luar skop yang diterangkan di sini tanpa persetujuan anda, kecuali di mana diperlukan untuk menyediakan perkhidmatan.

## 5. Keselamatan

Kami menerapkan langkah-langkah teknikal dan organisasi yang munasabat untuk melindungi data anda, termasuk:

- Kata laluan disimpan hanya sebagai **hash bcrypt** (dengan garam)
- Token sesi disimpan dalam **cookie httpOnly**, dengan token akses jangka pendek dan token segar yang boleh dibatalkan
- Pengesahan dua faktor (2FA) tersedia melalui kod e-mel
- transport dienkripsi dengan **HTTPS/TLS** pada gerbang awam
- Akses kepada rahsian konfigurasi mengehad dan tidak disimpan dalam kawalan sumber
- Kelayakan OAuth disediakan melalui aliran pengesahan pembekal yang selamat

Oleh kerana Apl ini adalah projek pembangunan/pembiakan yang dipasang sendiri, penerapan menggunakan **sijil TLS sendiri yang ditandatangani**; sambungan masih dienkripsi, tetapi tidak divalidasi oleh pihak berkuasa sijil awam. Anda tidak sepatutnya menggunakan Apl ini untuk menyimpan data yang sangat sensitif.

---

## 6. Penyimpanan

Kami menyimpan data peribadi anda hanya selama akaun anda masih wujud dan seangkatan yang diperlukan untuk menyediakan ciri-ciri yang anda gunakan. Data ephemer (keadaan pertandingan langsung, kehadiran, notifikasi, token keselamatan sementara) disimpan dalam memori dengan tamat tempoh automatik. Apabila anda menghapuskan akaun anda, data peribadi anda akan dihapuskan (lihat Bahagian 7).

---

## 7. Integriti data, akses, dan pembetulan (hak anda di bawah PDPA)

Di bawah PDPA, anda berhak untuk:

- **Akses**: meminta salinan data peribadi yang kami simpan tentang anda.
- **Pembetulan**: mengemaskini atau membetulkan data anda (anda juga boleh mengedit kebanyakan data anda sendiri di profil anda).
- **Penarikan / penghapusan**: meminta penghapusan akaun dan data anda.

**Menghapuskan akaun anda.** Anda boleh menghapuskan akaun anda terus dalam Apl (melalui profil anda). Menghapuskan akaun anda:

- Memadamkan secara kekal profil, sejarah pertandingan, pencapaian, rakan, notifikasi, dan avatar yang dimuat naik;
- Mengeluarkan data anda daripada jadual pemimpin; dan
- Log keluar dari semua peranti.

Untuk mana-mana permintaan akses, pembetulan, atau lain-lain, hubungi Tim (lihat Bahagian 9).

---

## 8. Integriti data

Kami mengambil langkah-langkah yang munasabat untuk memastikan data peribadi yang kami simpan adalah tepat, lengkap, dan tidak mengelirukan, dan kami membetulkan atau mengemaskininya apabila anda memberitahu kami atau mengeditnya sendiri.

---

## 9. Hubungi kami

Untuk sebarang soalan, aduan, atau permintaan yang berkaitan dengan data peribadi anda di bawah PDPA, sila hubungi Tim melalui saluran perhubungan projek (seperti yang disenaraikan dalam README projek).

---

## 10. Perubahan kepada Dasar ini

Kami mungkin mengemaskini Dasar Privasi ini dari masa ke semasa. Versi semasa akan sentiasa tersedia dalam Apl. Penggunaan berterusan anda terhadap Apl selepas perubahan kepada Dasar ini termasuk sebagai penerimaan terhadap Dasar Privasi yang dikemaskini.
