Tuya2Matter Add-on
==================

The Tuya2Matter add-on bridges your Tuya devices into Matter, so they can be discovered and controlled by Home Assistant, Apple Home, Google Home, or any other Matter controller.

* * * * *

Installation
------------

1.  In Home Assistant, go to Settings → Add-ons → Add-on Store.

2.  Click the ⋮ (menu) button in the top-right corner and choose Repositories.

3.  Add this repository URL:\
    <https://github.com/duongvanba/tuya2matter>

4.  After adding the repository, the Tuya2Matter add-on will appear in the store.

5.  Click Install to install the add-on.

* * * * *

Configuration
-------------

1.  Get your User Code from the Smart Life / Tuya Smart app:

    -   On the tab bar, select "Me".

    -   Tap the gear icon (⚙️) in the top-right corner.

    -   Select "Account and Security".

    -   At the bottom, your User Code will be shown.

2.  Open the Tuya2Matter add-on in Home Assistant.

3.  Go to the Configuration tab.

4.  Enter your User Code into the field `user_code`.

5.  Click Save.\
    Note: The add-on will only start for the first time after you click Save.

* * * * *

Pairing with Matter
-------------------

1.  After you Save and the add-on starts, open the Log tab.

2.  The add-on will display a Matter QR code.

3.  Open your Matter-compatible app (Home Assistant, Apple Home, Google Home, etc.).

4.  Add a new Matter device and scan the QR code from the log.

5.  Follow the on-screen steps until the pairing process asks for Tuya confirmation.

* * * * *

Tuya Confirmation Step
----------------------

1.  After Matter pairing is complete, the add-on will print another QR code in the log -- this is the Tuya confirmation code.

2.  Open the Smart Life / Tuya Smart app.

3.  Use the built-in scanner and scan the Tuya QR code from the log.

4.  Confirm the binding in the app.

* * * * *

Done!
-----

Your Tuya account and devices are now linked to your Matter fabric.\
The devices should appear in your smart home system and can be used in automation immediately. 🎉