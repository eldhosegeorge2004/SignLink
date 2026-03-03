import tensorflow as tf
import numpy as np
import os
import json

def load_data():
    """Load both static and dynamic datasets, with fallback for legacy format"""
    data = {}
    
    # Load static data
    if os.path.exists("X_static.npy") and os.path.exists("y_static.npy"):
        print("Loading static dataset...")
        data['X_static'] = np.load("X_static.npy")
        data['y_static'] = np.load("y_static.npy")
        # Shuffle static data before training
        indices = np.arange(data['X_static'].shape[0])
        np.random.shuffle(indices)
        data['X_static'] = data['X_static'][indices]
        data['y_static'] = data['y_static'][indices]
        print(f"Static data shape: X={data['X_static'].shape}, y={data['y_static'].shape}")
    
    # Load dynamic data
    if os.path.exists("X_dynamic.npy") and os.path.exists("y_dynamic.npy"):
        print("Loading dynamic dataset...")
        data['X_dynamic'] = np.load("X_dynamic.npy")
        data['y_dynamic'] = np.load("y_dynamic.npy")
        print(f"Dynamic data shape: X={data['X_dynamic'].shape}, y={data['y_dynamic'].shape}")
    
    # Load labels
    if os.path.exists("labels_static.json"):
        with open("labels_static.json", "r") as f:
            data['labels_static'] = json.load(f)
    
    if os.path.exists("labels_dynamic.json"):
        with open("labels_dynamic.json", "r") as f:
            data['labels_dynamic'] = json.load(f)
    
    # Fallback for old format (legacy ASL dataset)
    if not data and os.path.exists("X.npy") and os.path.exists("y.npy"):
        print("Loading legacy dataset from X.npy and y.npy...")
        data['X_static'] = np.load("X.npy")
        data['y_static'] = np.load("y.npy")
        # Shuffle legacy data
        indices = np.arange(data['X_static'].shape[0])
        np.random.shuffle(indices)
        data['X_static'] = data['X_static'][indices]
        data['y_static'] = data['y_static'][indices]
        if os.path.exists("labels.json"):
            with open("labels.json", "r") as f:
                data['labels_static'] = json.load(f)
    
    if not data:
        print("No dataset found. Please run 'convert_dataset.py' first.")
        return None
    
    return data

def train_static_model(X, y, labels):
    """Train static sign recognition model"""
    print("\n=== Training Static Model ===")
    print(f"Data shape: X={X.shape}, y={y.shape}")
    print(f"Classes: {labels}")
    
    num_classes = y.shape[1]
    
    model = tf.keras.Sequential([
        tf.keras.layers.Dense(128, activation='relu', input_shape=(63,)),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    
    print("Training static model...")
    model.fit(X, y, epochs=100, batch_size=32, validation_split=0.1, verbose=1)
    
    # Save model (works for both ASL and ISL)
    model_save_path = "isl_model_static.h5"
    model.save(model_save_path)
    print(f"Static model saved to '{model_save_path}'")
    
    return model

def train_dynamic_model(X, y, labels, timesteps=30):
    """Train dynamic sign recognition model with LSTM"""
    print("\n=== Training Dynamic Model ===")
    print(f"Data shape: X={X.shape}, y={y.shape}")
    print(f"Classes: {labels}")
    
    num_classes = y.shape[1]
    
    model = tf.keras.Sequential([
        tf.keras.layers.LSTM(64, return_sequences=True, input_shape=(timesteps, 63)),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32, return_sequences=False),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    
    print("Training dynamic model...")
    model.fit(X, y, epochs=50, batch_size=16, validation_split=0.1, verbose=1)
    
    # Save model
    model_save_path = "isl_model_dynamic.h5"
    model.save(model_save_path)
    print(f"Dynamic model saved to '{model_save_path}'")
    
    return model

def train_model():
    """Main training function"""
    data = load_data()
    if not data:
        return
    
    # Train static model if data exists
    if 'X_static' in data and 'y_static' in data:
        static_model = train_static_model(
            data['X_static'], 
            data['y_static'], 
            data.get('labels_static', [])
        )
        print("\nTo convert static model to TensorFlow.js:")
        print("tensorflowjs_converter --input_format keras isl_model_static.h5 ../public/model_static")
    
    # Train dynamic model if data exists
    if 'X_dynamic' in data and 'y_dynamic' in data:
        dynamic_model = train_dynamic_model(
            data['X_dynamic'], 
            data['y_dynamic'], 
            data.get('labels_dynamic', [])
        )
        print("\nTo convert dynamic model to TensorFlow.js:")
        print("tensorflowjs_converter --input_format keras isl_model_dynamic.h5 ../public/model_dynamic")
    
    print("\n=== Training Complete ===")
    print("Update 'translation.js' to load these new models if needed.")

if __name__ == "__main__":
    train_model()
