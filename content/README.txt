MaXMB CONTENT FOLDER
====================

This is the System's content folder. Everything the System keeps lives here,
next to MaXMB.exe (during development: project-root\content). Nothing is kept
in AppData; temporary files go to Windows' Temp folder (%TEMP%\MaXMB).

Most folders are made the first time the System starts. Folders marked
(made when used) appear once you use the feature.


GAMES
-----
  Games\        One folder per game. In a game's folder:
                  - the program to start: a .exe, a shortcut (.lnk / .url /
                    .xmbl), or a script (.bat, .ps1, .py, .jar...)
                  - icon.png (or .jpg / .webp / .gif): the icon. Without one,
                    the program's own icon is used
                  - background.png (or .jpg / .webp): the background
                  - preview.mp4 (or .webm / .mov / .gif): the animated icon
                  - music.flac (or .wav / .ogg / .mp3 / .opus / .m4a / .aac):
                    the game's music
                  - game.json: the game's details (Title, Created, Console...).
                    It's made by itself and changed from
                    Settings > Game Settings > Game Information.
                A PS3 game folder (with PARAM.SFO) works too: ICON0.PNG and
                PIC1.PNG are used as icon and background. Folders inside
                Games\ that hold game folders show as folders (albums).
                Games found by Game Recognition get their folder here
                automatically, with a shortcut to the game.


MEDIA
-----
  Music\        Songs (MP3, FLAC, OGG, M4A, WAV, Opus, AAC...). Song details
                and covers are read from the files' tags. Sub-folders are
                albums.
  Photos\       Pictures (JPG, PNG, GIF, WEBP, BMP...). Sub-folders are
                albums.
                  Screenshots\   (made when used) the screenshots you take
                  Sections\      pictures to use as Custom Section icons
  Videos\       Videos (MP4, WEBM, MKV, AVI, MOV...). Videos the System can't
                play directly are converted with FFmpeg (needed for that).
                Sub-folders are albums.
  Subtitles\    Subtitle files (SRT, VTT, ASS), offered in the Video Player's
                Subtitle Options.

  Files found by File Recognition (Settings > System Settings > Media
  Folders) get a shortcut (.xmbl) here, in a folder named after the folder
  they came from. The files themselves stay where they are.


CUSTOM SECTIONS
---------------
  <Section name>\   (made when used) Each Custom Section you create
                (Settings > System Settings > Sections) gets a folder named
                after it, and each of its subsections a folder inside that
                one, named after the subsection (its files show inside the
                subsection). Every item in a section has its own folder (like a
                game). A file put loose in the section's folder is moved into a
                new folder named after it. A folder you make there and put
                several files in is an album (shown as a folder with "By
                Album"): each of its files gets a folder of its own inside it.
                An item's item.json is made automatically; put icon / preview
                (GIF or video) / background / music files in its folder to use
                them. PDFs and comics (CBZ, CBT) open in the Photo Viewer;
                programs and scripts start like games, and keep their details
                in a program.json (Format: PC). Changes in a section's folders
                show as soon as you go to the section.


LOOK AND SOUND
--------------
  Themes\       PS3 themes (.p3t files, sub-folders too) and Custom Themes
                (.zip files made with Create Custom Theme). Put a theme here to
                add it.
  Themes Extracted\  (made when used) What Extract Theme takes out of a PS3
                theme: icons, backgrounds, sounds and more.
  Icon\         Icon Sets: one folder each, with replacement icons named like
                the System's (icon_game.png, icon_setting.png...) and a .json
                naming it, for example { "name": "My Icons" }. "Flat Icons"
                comes with the System. A set can also hold "Music Player",
                "Video Player" and "Photo Viewer" folders with the players'
                icons (the names used in "Flat Icons"). Only the icons a set
                has replace the System's.
  Sound Effects\  Sound Effect Sets: one folder of replacement sounds each,
                with a .json naming it, for example { "name": "My Sounds" }.
                "Original Sounds" (a base to start from) and "PS4 Sounds" come
                with the System. The names:
                cursor, enter, back, coldboot (the startup sound), and if you
                want them apart: error and ok (otherwise the enter sound) and
                options (an option menu opening; silent otherwise). Formats:
                .ogg, .wav, .mp3, .flac, .m4a, .aac, .opus. Sounds a set
                doesn't have stay as they are.
  Fonts\        Fonts to choose in Theme Settings > Text and Color > Font
                (.ttf, .otf, .woff, .woff2).


PSN AVATARS
-----------
  Avatars\PSN\  The PSN avatars are only the pictures in this folder (PNG,
                JPG, GIF, WEBP or BMP, any file name). They're read when the
                System starts, so after adding some, restart it. They show
                newest file first in Change Avatar and on random PSN friends.
                With no pictures here, every PSN friend and account has the
                default grey face and the PSN avatar selection is empty. A
                picture removed from the folder turns into the grey face
                wherever it was used.


INTERNET BROWSER
----------------
  Browser\      The Internet Browser's files. Put the portable LibreWolf here
                (Browser\LibreWolf\librewolf.exe); an installed LibreWolf is
                found too. Its profile (Browser\Profiles\Default) keeps your
                browser settings, extensions and userscripts. The System also
                keeps its own small helper extension here.


LOGS
----
  Logs\         MaXMB.log: what went wrong while the System ran (errors,
                warnings and crashes), made fresh at every start. The one from
                the start before is kept as "MaXMB (previous).log". Post it
                with a bug report.


SYSTEM DATA
-----------
  data\         Made and managed by the System. Don't edit these by hand.
                  settings.json, users.json, psn.json   settings, users and
                                                        PSN accounts
                  game_sources.json   the Game Recognition source folders
                  covers\             song covers read from the songs
                  shortcut_icons\     icons taken from games' programs
                  video_icons\        icons made with Change Icon
                  preloaded_songs\    pre-loaded songs, with Keep Pre-Loaded
                                      Songs Data on
                  cache\              kept caches: theme files, converted
                                      videos, and, with Save Cache in System
                                      Directory, thumbnails and icon shading
                  webview\            the System's own display engine data

  Deleting data\ resets the System (users, settings and PSN accounts are lost).
