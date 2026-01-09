# Sign Language Video Call Application

A real-time video calling application with integrated Indian Sign Language (ISL) recognition using MediaPipe and TensorFlow.js.

## Prerequisites
- Node.js installed
- Python (for training model, optional)

## Installation

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

## Running the Application

1.  **Start the Server**:
    ```bash
    npm start
    # OR
    node server.js
    ```

2.  **Open in Browser**:
    - Go to `http://localhost:3000`
    - Allow Camera/Microphone permissions.
    - Enter a Room ID (e.g., "room1") and click "Join Room".
    - Open a second tab, go to `http://localhost:3000`, enter the *same* Room ID, and join.

## ML Model & Training

The application expects a TensorFlow.js model at `public/model/model.json`.

### Training a New Model
1.  Navigate to `training/` folder.
2.  (Optional) Collect data and save as `X.npy` and `y.npy`.
3.  Run the training script:
    ```bash
    python train.py
    ```
4.  Convert the saved Keras model to TF.js format:
    ```bash
    tensorflowjs_converter --input_format keras isl_model_h5 ../public/model
    ```

## Features
- **Video Call**: WebRTC peer-to-peer video/audio.
- **Hand Tracking**: MediaPipe Hands draws landmarks on your local video.
- **Sign Recognition**: Simple TensorFlow.js integration (requires trained model).
