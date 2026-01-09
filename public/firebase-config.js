import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyDKZVnsNrbI59zRIJpe92QNKaz8UiZbRfA",
    authDomain: "signlink-3cee9.firebaseapp.com",
    projectId: "signlink-3cee9",
    storageBucket: "signlink-3cee9.firebasestorage.app",
    messagingSenderId: "1077588849238",
    appId: "1:1077588849238:web:93609232455119d3bf01f7",
    measurementId: "G-Y909CN3LZZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, analytics, db };
