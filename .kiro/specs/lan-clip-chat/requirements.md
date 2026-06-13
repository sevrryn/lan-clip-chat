# Requirements Document

## Introduction

LAN Clip Chat v1 is a portable Windows desktop application (no installation required) that allows users on the same local area network (LAN) to communicate via text and image messages and transfer files — all without internet servers, cloud services, or user accounts. One user acts as the Host by creating a room and receiving a 6-digit room code. Other users join using that code. The Host is a normal participant who can also chat and transfer files; the Host's exclusive privilege is ending the session. The application is built with Electron + Node.js and packaged as a single portable Windows executable.

## Glossary

- **Application**: The LAN Clip Chat portable Windows desktop application.
- **Host**: The user who created the room. The Host runs the WebSocket server. The Host participates in chat and file transfer like any other user.
- **Client**: Any participant who joined the room using a room code. A Client connects to the Host's WebSocket server.
- **Participant**: Any connected user, including the Host.
- **Room**: An active session identified by a 6-digit room code, hosted on the Host's machine.
- **Room_Code**: A randomly generated 6-digit numeric string (e.g., "482915") that uniquely identifies a Room.
- **Startup_Screen**: The initial application screen shown on launch, containing a name input and "Create Room" / "Join Room" buttons.
- **Main_Window**: The primary application screen shown after joining a Room, containing the user list, chat area, and input controls.
- **WebSocket_Server**: The Node.js WebSocket server started by the Host on the Host's machine.
- **Message**: A text or image communication unit sent between Participants.
- **File_Transfer**: The chunked, background transmission of a file from one Participant to all others.
- **Chunk**: A fixed-size binary segment used during File_Transfer to avoid loading entire files into memory.
- **Typing_Indicator**: A transient UI element displayed when another Participant is actively composing a message.
- **Connection_Status_Indicator**: A persistent UI element showing the current connection state: Connected, Reconnecting, or Disconnected.
- **Context_Menu**: A right-click popup menu on a Message with actions available to the user.
- **Clipboard**: The Windows system clipboard accessed via Ctrl+V within the message input area.

---

## Requirements

### Requirement 1: Application Launch and Startup Screen

**User Story:** As a user, I want to see a startup screen when the application launches, so that I can enter my name and choose to create or join a room.

#### Acceptance Criteria

1. WHEN the Application is launched, THE Application SHALL display the Startup_Screen before any other screen is shown.
2. THE Startup_Screen SHALL contain a text input field labeled "Enter Your Name", a "Create Room" button, and a "Join Room" button.
3. WHEN the user attempts to create or join a room and the name field is empty or contains only whitespace after trimming, THE Application SHALL display a validation error message adjacent to the name input field and shall not proceed with the action.
4. THE Application SHALL accept a name of 1–50 non-whitespace characters after trimming leading and trailing whitespace from the entered value.

---

### Requirement 2: Create Room

**User Story:** As a user, I want to create a room, so that others on the LAN can connect to me using a room code.

#### Acceptance Criteria

1. WHEN the user clicks "Create Room" with a valid name (1–32 printable non-whitespace-only characters), THE Application SHALL generate a random 6-digit Room_Code and start the WebSocket_Server on the Host's machine.
2. WHEN the user clicks "Create Room" with an invalid name, THE Application SHALL display an inline validation error and not start the WebSocket_Server.
3. THE Application SHALL generate the Room_Code using a uniformly random selection from the range 000000–999999, zero-padded to 6 digits.
4. WHEN the WebSocket_Server starts successfully, THE Application SHALL transition to the Main_Window and display "Session / Room [Room_Code]" in the header, using the name the Host entered.
5. THE Application SHALL automatically add the Host as a Participant in the Room upon successful server start.
6. IF the WebSocket_Server fails to start for any reason, THEN THE Application SHALL display an error message and return the user to the Startup_Screen.

---

### Requirement 3: Join Room

**User Story:** As a user, I want to join an existing room using a room code, so that I can communicate with the Host and other participants.

#### Acceptance Criteria

1. WHEN the user clicks "Join Room" with a valid name (1–32 characters, letters/numbers/spaces only), THE Application SHALL prompt the user to enter a Room_Code.
2. WHEN the user submits a Room_Code, THE Application SHALL validate that it consists of exactly 6 numeric digits before attempting connection.
3. IF the Room_Code format is invalid, THEN THE Application SHALL display an inline validation error and not attempt a connection.
4. WHEN a valid Room_Code is entered, THE Application SHALL discover and connect to the Host on the LAN via WebSocket using the Room_Code to identify the target host.
5. WHEN the WebSocket connection is established successfully, THE Application SHALL transition to the Main_Window.
6. IF the connection attempt fails (host not found, refused, or timed out), THEN THE Application SHALL display an error message indicating the specific failure reason and remain on the join prompt screen.
7. IF a connection attempt has not succeeded within 10 seconds, THEN THE Application SHALL treat the attempt as failed and apply criterion 6.

---

### Requirement 4: Main Window Layout

**User Story:** As a Participant, I want a clear main window layout, so that I can see the room info, connected users, and chat area at all times.

#### Acceptance Criteria

1. THE Main_Window SHALL display a header containing "Session / Room [Room_Code]" and a "Leave" button.
2. THE Main_Window SHALL display a Connected Users panel listing the name of every currently connected Participant.
3. THE Main_Window SHALL display the Host's name suffixed with "(Host)" in the Connected Users panel.
4. THE Main_Window SHALL display a scrollable chat messages area that automatically scrolls to the bottom when a new message arrives, unless the user has manually scrolled up, in which case the position SHALL be preserved.
5. THE Main_Window SHALL display a Typing_Indicator area below the chat messages area.
6. THE Main_Window SHALL display a message input field with a maximum of 2,000 characters (no further characters accepted beyond this limit), a "Send" button, and a "Send File" button.
7. THE Main_Window SHALL display a Connection_Status_Indicator at all times.

---

### Requirement 5: Connection Status Indicator

**User Story:** As a Participant, I want a connection status indicator, so that I always know whether I am connected, reconnecting, or disconnected.

#### Acceptance Criteria

1. THE Connection_Status_Indicator SHALL display one of three states: "● Connected", "● Reconnecting...", or "● Disconnected".
2. WHEN the Application first displays the Main_Window, THE Connection_Status_Indicator SHALL display "● Connected".
3. WHEN the WebSocket connection is open and the last received message or pong was received within the last 30 seconds, THE Connection_Status_Indicator SHALL display "● Connected".
4. WHEN the WebSocket connection drops and a reconnection attempt is in progress, THE Connection_Status_Indicator SHALL display "● Reconnecting...".
5. IF all reconnection attempts have been exhausted without success, THEN THE Connection_Status_Indicator SHALL display "● Disconnected".
6. THE Connection_Status_Indicator SHALL update within 1 second of a state change without requiring user interaction.

---

### Requirement 6: Leave and End Session

**User Story:** As a Participant, I want to leave a room, and as the Host, I want to end the session for all users, so that sessions can be cleanly terminated.

#### Acceptance Criteria

1. WHEN a Client clicks the "Leave" button, THE Application SHALL display a confirmation dialog with the prompt "Leave Room?" and buttons "Leave" and "Cancel".
2. WHEN the Client confirms by clicking "Leave" in the dialog, THE Application SHALL disconnect from the WebSocket_Server.
3. IF the Client disconnect from the WebSocket_Server succeeds, THEN THE Application SHALL return the Client to the Startup_Screen.
4. IF the Client disconnect from the WebSocket_Server fails, THEN THE Application SHALL display an error message indicating the disconnection failed and return the Client to the Startup_Screen.
5. WHEN the Host clicks the "Leave" button, THE Application SHALL display a confirmation dialog with the prompt "End Session? All users will be disconnected." and buttons "End Session" and "Cancel".
6. WHEN the Host confirms by clicking "End Session", THE WebSocket_Server SHALL broadcast a "session-ended" event to all connected Clients, waiting up to 3 seconds for the broadcast to complete before proceeding to shut down.
7. WHEN a Client receives a "session-ended" event, THE Application SHALL display the message "Session ended by host." for 3 seconds, then return the Client to the Startup_Screen.
8. WHEN the Host confirms session end, THE Application SHALL stop the WebSocket_Server after the broadcast step in criterion 6 completes or times out, then return the Host to the Startup_Screen.
9. WHILE no active Room session exists, THE Application SHALL disable the "Leave" button so it cannot be activated.

---

### Requirement 7: User List Updates

**User Story:** As a Participant, I want the connected users list to update in real time, so that I always know who is in the room.

#### Acceptance Criteria

1. WHEN a new Participant joins the Room, THE Application SHALL add that Participant's name to the Connected Users panel on all connected Clients within 500 ms of the join event being broadcast.
2. WHEN a Participant leaves or disconnects from the Room, THE Application SHALL remove that Participant's name from the Connected Users panel on all remaining Clients within 500 ms of the leave event being broadcast.
3. WHEN a Client first connects to the Room, THE WebSocket_Server SHALL immediately send the full current Participant list to that Client so the Connected Users panel is populated before any subsequent join/leave events arrive.
4. THE WebSocket_Server SHALL maintain the authoritative list of connected Participants and broadcast the full updated list on every join and leave event.
5. IF the user list broadcast fails to reach a Client, THE WebSocket_Server SHALL re-send the full current Participant list to that Client upon its next successful reconnection.

---

### Requirement 8: Text Messages

**User Story:** As a Participant, I want to send and receive text messages, so that I can communicate with others in the room.

#### Acceptance Criteria

1. WHEN the user clicks "Send" or presses Enter with text in the message input, THE Application SHALL transmit the message content and sender name to the WebSocket_Server.
2. THE Application SHALL reject any send attempt where the message text is empty or contains only whitespace, and SHALL NOT transmit such a message or clear the input field.
3. THE Application SHALL enforce a maximum message length of 500 characters in the message input field, preventing entry of characters beyond this limit.
4. THE WebSocket_Server SHALL broadcast every received text message to all Participants including the sender.
5. WHEN a text message is received, THE Application SHALL display the sender's name above the message content in the chat area.
6. THE Application SHALL display messages in chronological order based on the time they were received by the local client.
7. WHEN the user sends a message successfully, THE Application SHALL clear the message input field.
8. IF message transmission fails, THEN THE Application SHALL display an inline error and retain the message text in the input field.
9. THE Application SHALL reject and discard any incoming text message where the message content field is empty, absent, or exceeds 500 characters.

---

### Requirement 9: Typing Indicator

**User Story:** As a Participant, I want to see when someone is typing, so that I know a message is coming.

#### Acceptance Criteria

1. WHEN a Participant enters text in the message input field, THE Application SHALL send a typing event to the WebSocket_Server, throttled to at most one event every 2 seconds per Participant.
2. WHEN a typing event is received from a Participant, THE WebSocket_Server SHALL broadcast the typing event to all Participants except the sender.
3. WHEN a typing event is received for a remote Participant, THE Application SHALL display "[Name] is typing..." in the Typing_Indicator area.
4. IF no new typing event is received from the same Participant within 3 seconds, THEN THE Application SHALL hide the Typing_Indicator for that Participant.
5. WHEN a Participant sends a message, THE Application SHALL immediately clear the Typing_Indicator for that Participant without waiting for the 3-second timeout.
6. THE Application SHALL display only one Typing_Indicator line at a time, showing the Participant whose most recent typing event has the latest timestamp.
7. THE Application SHALL NOT display a Typing_Indicator for the local user's own typing.

---

### Requirement 10: Clipboard Support (Ctrl+V)

**User Story:** As a Participant, I want to paste clipboard content with Ctrl+V, so that I can quickly share text or images without using the file picker.

#### Acceptance Criteria

1. WHEN the user presses Ctrl+V while the message input field is focused and the clipboard contains plain text, THE Application SHALL insert the clipboard text into the message input field at the current cursor position.
2. WHEN the user presses Ctrl+V while the message input field is focused and the clipboard contains an image but no plain text, THE Application SHALL send the image as an image message (type "image") immediately without requiring an additional send action.
3. WHEN the clipboard contains both plain text and an image, THE Application SHALL treat the content as plain text and apply criterion 1.
4. WHEN the clipboard content is neither plain text nor an image, THE Application SHALL take no clipboard action and SHALL allow the Ctrl+V keystroke to propagate normally to other handlers.
5. THE Application SHALL NOT support clipboard file detection or file sending via clipboard paste.

---

### Requirement 11: File Transfer

**User Story:** As a Participant, I want to send files to everyone in the room, so that I can share documents, archives, and other files without using external services.

#### Acceptance Criteria

1. WHEN the user clicks "Send File", THE Application SHALL open the Windows native file picker dialog allowing selection of any file type.
2. WHEN a file is selected, THE Application SHALL begin File_Transfer by reading and sending the file in fixed-size chunks, ensuring the entire file is never held in memory simultaneously.
3. THE Application SHALL support File_Transfer for files up to 900 MB in size.
4. IF the selected file exceeds 900 MB, THEN THE Application SHALL display an error message and cancel the transfer without sending any data.
5. THE File_Transfer SHALL occur without blocking the UI thread, such that the application remains interactive (input responds within 200 ms) during an active transfer.
6. WHEN a file begins transferring to a Participant, THE Application SHALL immediately display the filename, file size in human-readable form, a percentage and bytes-transferred progress indicator, a "Download" button, and an "Open" button in the chat area.
7. WHEN a File_Transfer completes successfully, THE Application SHALL update the progress indicator to show 100% and enable the "Download" and "Open" buttons.
8. THE Application SHALL NOT display file previews, thumbnails, or inline rendering for any file type.
9. THE Application SHALL NOT support drag-and-drop file sending.
10. WHEN a File_Transfer is interrupted before completion, THE Application SHALL notify the receiving Participant within 2 seconds that the transfer was interrupted.

---

### Requirement 12: Message Context Menu

**User Story:** As a Participant, I want a right-click context menu on messages, so that I can copy or delete messages.

#### Acceptance Criteria

1. WHEN the user right-clicks a message in the chat area, THE Application SHALL display a Context_Menu with the options "Copy Message" and "Delete Message", where "Delete Message" is enabled only for messages sent by the local user.
2. WHEN the user selects "Copy Message", THE Application SHALL copy the message text to the Windows system clipboard.
3. WHEN the user selects "Delete Message", THE Application SHALL display a confirmation dialog with the prompt "Delete message?" and buttons "Yes" and "No"; if the user clicks "No", the dialog SHALL close and no action SHALL be taken.
4. WHEN the user confirms deletion by clicking "Yes", THE Application SHALL send a deletion event to the WebSocket_Server containing the message identifier.
5. WHEN the WebSocket_Server receives a valid deletion request from a Participant, THE WebSocket_Server SHALL broadcast the deletion event to all Participants.
6. WHEN a deletion event is received, THE Application SHALL remove the identified message from the chat area on all Participants' screens.
7. IF the WebSocket_Server receives a deletion request for a message identifier that does not exist or was not sent by the requesting Participant, THEN THE WebSocket_Server SHALL reject the request and not broadcast a deletion event.

---

### Requirement 13: Host Permissions

**User Story:** As the Host, I want to participate in chat and file sharing like any other user, so that I am not excluded from the conversation I started.

#### Acceptance Criteria

1. THE Host SHALL be able to send text messages subject to the same character limits and delivery rules as any Client.
2. THE Host SHALL be able to receive text messages under the same conditions as any Client.
3. THE Host SHALL be able to send files subject to the same file size and type restrictions as any Client.
4. THE Host SHALL be able to receive files under the same conditions as any Client.
5. THE Host SHALL have no additional permissions beyond those available to all Clients, specifically excluding the ability to kick, ban, mute, or otherwise restrict any Participant.

---

### Requirement 14: Input Validation and Crash Prevention

**User Story:** As a developer, I want all incoming network messages to be validated, so that malformed data cannot crash the application.

#### Acceptance Criteria

1. THE Application SHALL validate every incoming WebSocket message by confirming it is valid JSON and contains a `type` field of type string before any further processing.
2. WHEN an incoming message has missing required fields for its declared type, THE Application SHALL discard the message and log a warning that includes the nature of the validation failure and the source connection identifier, without crashing.
3. WHEN an incoming message has an unrecognized "type" field value, THE Application SHALL discard the message without crashing.
4. WHEN an incoming message is not valid JSON, THE Application SHALL discard the raw data without crashing.
5. WHEN an incoming message exceeds 1 MB in size, THE Application SHALL discard it without processing and without crashing.
6. WHEN THE Application discards an invalid message, THE Application SHALL process the next valid incoming message without requiring a restart or reconnection.

---

### Requirement 15: Reconnection Logic

**User Story:** As a Client, I want the application to automatically attempt reconnection if my connection drops, so that temporary network interruptions do not require manual re-entry of the room code.

#### Acceptance Criteria

1. WHEN the WebSocket connection is lost unexpectedly, THE Application SHALL immediately display "● Reconnecting..." in the Connection_Status_Indicator.
2. WHEN in reconnecting state, THE Application SHALL attempt to re-establish the WebSocket connection using exponential back-off starting at 1 second and doubling each attempt, up to a maximum interval of 30 seconds.
3. WHEN reconnection succeeds, THE Application SHALL display "● Connected" immediately and the Participant SHALL reappear in the Room's participant list within 3 seconds.
4. IF reconnection attempts have continued for more than 2 minutes without success, THEN THE Application SHALL display "● Disconnected" and stop retrying.
5. WHEN the server responds to a reconnection attempt with an indication that the session is closed, THE Application SHALL stop reconnection attempts, display "Session ended by host.", and return the Client to the Startup_Screen.

---

### Requirement 16: Firewall Help

**User Story:** As a user, I want guidance on allowing the application through Windows Firewall, so that I can resolve connection issues without external support.

#### Acceptance Criteria

1. THE Main_Window SHALL display a "Connection Help" button that is always visible and enabled regardless of connection state.
2. WHEN the user clicks "Connection Help", THE Application SHALL display a titled dialog containing the following steps: (1) Open Windows Defender Firewall, (2) Click "Allow an app through Windows Firewall", (3) Click "Change Settings" then locate or add LAN Clip Chat, (4) Enable the checkbox for Private Networks, and (5) Click OK and retry the connection. The dialog SHALL include a dismiss/close action.
3. THE Application SHALL NOT attempt to modify firewall rules programmatically.
4. THE Application SHALL NOT attempt to bypass or disable Windows Defender Firewall.

---

### Requirement 17: LAN-Only Networking

**User Story:** As a user, I want all communication to stay on the local network, so that my data never leaves the LAN without my knowledge.

#### Acceptance Criteria

1. THE Application SHALL use WebSocket connections exclusively for all real-time communication between Participants.
2. THE Application SHALL NOT make any outbound connections to addresses outside the RFC 1918 private address space (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) or link-local address space (169.254.0.0/16), including for software updates, error reporting, or analytics.
3. THE Application SHALL NOT perform DNS lookups to resolve hostnames to external IP addresses for any application-initiated network operation.
4. THE Application SHALL NOT require or use user accounts, authentication tokens, or passwords.
5. THE WebSocket_Server SHALL bind only to non-loopback LAN interface addresses and SHALL NOT bind to any external or internet-facing interface. Loopback binding is permitted for local-only testing purposes.
6. THE Application SHALL NOT transmit Participant names, messages, or file data to any endpoint outside the LAN (as defined by criterion 2).

---

### Requirement 18: Portable Executable

**User Story:** As a user, I want the application to run as a single portable executable, so that I can use it without installing anything.

#### Acceptance Criteria

1. THE Application SHALL be packaged as a single portable Windows executable (.exe) that requires no installation step.
2. THE Application SHALL run on Windows 10 and Windows 11 without requiring additional runtime installations.
3. THE Application SHALL NOT require administrator privileges when launched from a user-writable path (e.g., Desktop, Downloads, or any path within the user's home directory).
4. WHEN the Application exits, THE Application SHALL delete all temporary files it created in %TEMP% or %APPDATA% during the session, while preserving any files explicitly saved by the user.
