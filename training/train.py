import tensorflow as tf
import numpy as np
import os

# Placeholder for loading data
# You need to populate X and y with your dataset
# X shape: (samples, 63) -> 21 landmarks * 3 coordinates (x,y,z)
# y shape: (samples, num_classes) -> One-hot encoded labels

def load_data():
    if os.path.exists("X.npy") and os.path.exists("y.npy"):
        X = np.load("X.npy")
        y = np.load("y.npy")
        return X, y
    else:
        print("Dataset not found. creating dummy data for demonstration.")
        # Dummy data: 100 samples, 63 features, 5 classes
        X = np.random.rand(100, 63)
        y = np.eye(5)[np.random.choice(5, 100)]
        return X, y

def train_model():
    X, y = load_data()
    num_classes = y.shape[1]

    model = tf.keras.Sequential([
        tf.keras.layers.Dense(128, activation='relu', input_shape=(63,)),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])

    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    
    print("Starting training...")
    model.fit(X, y, epochs=50, batch_size=32)
    
    # Save Keras model
    model.save("isl_model_h5")
    print("Model saved to 'isl_model_h5'")

    # Instructions to convert
    print("\nTo convert to TensorFlow.js format, run:")
    print("tensorflowjs_converter --input_format keras isl_model_h5 ../public/model")

if __name__ == "__main__":
    train_model()
