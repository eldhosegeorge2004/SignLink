import tensorflow as tf
import tensorflowjs as tfjs

print("Loading Keras Model...")
model = tf.keras.models.load_model('asl_model.h5')
print("Model loaded into memory. Exporting mapping JSON...")
tfjs.converters.save_keras_model(model, '../public/model/asl')
print("Successfully generated TFJS bundle.")
