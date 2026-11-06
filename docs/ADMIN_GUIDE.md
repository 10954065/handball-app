# Administrator guide

This guide is for the person responsible for the HMMS computer and its data.

## Installing HMMS

You need Windows 10 or 11 (64-bit) and about 500 MB of free disk space. You do not need an internet connection or any other software.

1. Copy `HMMS-Setup-<version>.exe` to the computer, from a USB drive for example.
2. Double-click it.
3. Windows may show **Windows protected your PC**, because the installer has no paid publisher certificate. Check that the file came from your association, choose **More info**, then **Run anyway**.
4. Choose who to install for. **Only for me** needs no administrator rights and suits a computer with one Windows account. **Anyone who uses this computer** may ask for an administrator password. Each Windows account keeps its own separate data, so everyone at the table should use the same account.
5. Follow the remaining steps, then open HMMS from the desktop icon.

> Your antivirus may also ask about the installer. Only allow it if it came from a source you trust.

### First start

1. Enter your organisation's name and create the administrator account. The password needs at least 8 characters, with letters and numbers.
2. Sign in, and create an account for each person under **Settings**, **Users & access**.
3. Go to **Settings**, **General & match**, and check the organisation name and default match rules.
4. Go to **Settings**, **Backup & restore**, and choose **Export to USB / folder** to confirm your USB drive works.

**A lost password can only be reset by an administrator, so create a second administrator account and keep its details somewhere safe.**

## Accounts

| Role | Give it to |
| --- | --- |
| Administrator | One or two responsible people |
| Operator | Anyone who runs matches or enters data |
| Viewer | Anyone who only needs to look |

Accounts are never deleted, so the audit log always shows who did what. Turn off **Account active** when someone leaves. Everyone should have their own account.

To set a new password for someone, edit their account under **Users & access**.

## Where your data is

| Item | Location |
| --- | --- |
| Database | `%APPDATA%\HMMS\data\hmms.db` |
| Demonstration data | `%APPDATA%\HMMS\data\hmms-demo.db` |
| Backups | `%APPDATA%\HMMS\backups\` |
| Logs | `%APPDATA%\HMMS\logs\` |

**Settings**, **System & audit** shows the exact folders and can open them.

## Backups

HMMS makes these copies by itself, and verifies each one:

- every 30 minutes while data is changing, and when HMMS closes
- when a match is finalized
- before a restore, and before an update changes your data

You choose the interval and how many automatic backups to keep under **Settings**, **General & match**. Copies made before a restore or an update are never removed automatically.

**Backups on the same computer do not protect you if that computer is lost, stolen or fails.** After every match day, choose **Export to USB / folder** and store the drive somewhere else.

To check the database at any time, choose **Integrity check** under **Backup & restore**.

## Restoring a backup

Under **Settings**, **Backup & restore**, choose **Restore** beside a backup in the list, or **Restore from file** for one on a USB drive. HMMS verifies the file and saves a copy of your current data first, so a restore can always be undone. Everyone has to sign in again afterwards.

### If HMMS cannot open its data

If the data file is damaged, HMMS shows **HMMS cannot open its data** when it starts. You can:

- **Restore the latest backup**, the newest one that passes verification
- **Choose a backup file**, from a USB drive for example
- **Quit HMMS**, which changes nothing, and is what pressing Enter does

HMMS offers this only when the file itself is damaged or missing. If something else stops it opening, such as a failed update or a locked file, it says so and quits, because your data is safe.

The damaged file is moved to a dated `damaged-...` folder beside the database and is never erased. Anything entered after the backup was taken is not included, so check recent matches afterwards.

After HMMS closes unexpectedly, the next start takes a little longer because it checks the whole data file.

## Moving to a new computer

1. On the old computer, choose **Export to USB / folder**.
2. Install HMMS on the new computer and create a temporary administrator account.
3. Choose **Restore from file** and pick the backup. Your original accounts and data come back, and the temporary account goes.

## Updating HMMS

1. Export a backup to USB first.
2. Close HMMS, then run the new installer over the existing copy, choosing the same option as before. There is no need to uninstall.
3. Open HMMS. If the update changes the data format, HMMS saves a copy first, listed as **Before update** in the backup history. If that copy cannot be saved, the update stops and your data stays as it was.

Do not update during a live match.

### Going back to an older version

An older version refuses to open data that a newer version has updated, and says so. Going back means returning to the **Before update** copy, so anything entered since then is lost.

1. Export a backup to USB, then close HMMS.
2. Install the older version.
3. In `%APPDATA%\HMMS\data\`, rename `hmms.db` to something like `hmms-newer.db`.
4. Open HMMS. It reports that the data file is missing.
5. Choose **Choose a backup file** and pick the file with `pre_update` in its name from `%APPDATA%\HMMS\backups\`.

## Uninstalling

Use **Settings**, **Apps** in Windows. Uninstalling removes the program and leaves your data in `%APPDATA%\HMMS`, so a later installation picks it up again. To remove the data as well, delete that folder by hand after making sure you have a copy.

## Correcting a finalized match

Administrators can correct a finalized match from its timeline in the Match Centre. Each correction needs a reason and is recorded in the audit log. The match shows as **Final (amended)**, statistics and tables update by themselves, and saved reports are marked as out of date. Generate them again if they have already gone out.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| HMMS cannot open its data | Follow the steps above |
| "This data was saved by a newer version" | Install that version or a later one. Your data is fine |
| HMMS needs to update its data but could not save a safety copy | Check there is free disk space and start HMMS again |
| HMMS cannot start, and says your data is safe | Restart the computer. If it happens again, send the log folder to your support contact |
| "A match is in progress" when opening demonstration mode | Finish the match first |
| The same screen keeps failing | Close HMMS, open it again, and send the log folder to your support contact |
| Windows blocks the installer | See Installing HMMS above |

**Settings**, **System & audit**, **Open log folder** shows the log files. There is one for each day HMMS is used, and the 14 most recent are kept. Logs contain no passwords.

## Security notes

- HMMS is one installation on one computer. Everyone using that Windows account can reach the data files, so use a Windows password and lock the computer when it is unattended.
- The data files and backups are not encrypted. Treat a backup USB drive as carefully as paper team sheets, because it holds players' personal details.
- Sign out when you leave the table. Sessions end when HMMS closes.
