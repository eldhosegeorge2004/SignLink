import tensorflow as tf
import numpy as np
import os
import json

def load_data():
    if os.path.exists("X.npy") and os.path.exists("y.npy"):
        print("Loading dataset from X.npy and y.npy...")
        X = np.load("X.npy")
        y = np.load("y.npy")
        
        # VERY IMPORTANT: Shuffle data before Keras splits for validation!
        indices = np.arange(X.shape[0])
        np.random.shuffle(indices)
        X = X[indices]
        y = y[indices]
        
        return X, y
    else:
        print("Dataset (X.npy, y.npy) not found.")
        print("Please run 'convert_dataset.py' first to generate them.")
        # Fallback to dummy data just to prevent crash if run accidentally
        print("Creating dummy data for demonstration...")
        X = np.random.rand(100, 63)
        y = np.eye(5)[np.random.choice(5, 100)]
        return X, y

def train_model():
    X, y = load_data()
    print(f"Data shape: X={X.shape}, y={y.shape}")
    
    num_classes = y.shape[1]
    
    # Load labels if available to print
    if os.path.exists("labels.json"):
        with open("labels.json", "r") as f:
            labels = json.load(f)
        print(f"Training on {len(labels)} classes: {labels}")

    model = tf.keras.Sequential([
        tf.keras.layers.Dense(128, activation='relu', input_shape=(63,)),
        tf.keras.layers.Dropout(0.2), # Added dropout for better generalization
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])

    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    
    print("Starting training...")
    # Increased epochs for real data
    model.fit(X, y, epochs=100, batch_size=32, validation_split=0.1)
    
    # Save Keras model
    model_save_path = "asl_model.h5"
    model.save(model_save_path)
    print(f"Model saved to '{model_save_path}'")

    # Instructions to convert
    print("\nTo convert to TensorFlow.js format, run the following command in terminal:")
    print(f"tensorflowjs_converter --input_format keras {model_save_path} ../public/model")
    print("\nThen, update 'translation.js' to load this new model if needed (or overwrite existing files).")

if __name__ == "__main__":
    train_model()
