const form = document.getElementById('contactForm');
const successAlert = document.querySelector(".success-alert");
const errorAlert = document.querySelector(".error-alert");

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const config = {
    apiKey: "AIzaSyBtkn8N_njw4ICKLkzqSSBsuV5uQOzQyLM",
    authDomain: "harisheoran-c3a13.firebaseapp.com",
    databaseURL: "https://harisheoran-c3a13-default-rtdb.firebaseio.com",
    projectId: "harisheoran-c3a13",
    storageBucket: "harisheoran-c3a13.appspot.com",
    messagingSenderId: "962244538381",
    appId: "1:962244538381:web:6d1644b8dbe03390fda544",
    measurementId: "G-5TXFZLWMBX"
};

// Initialize Firebase
firebase.initializeApp(config);


const database = firebase.database()

const ref = database.ref("messages")


form.addEventListener("submit", (e) => {

    e.preventDefault();

    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;


    ref.push({
        name: name,
        email: email,
        message: message
    }).then(() => {
        successAlert.style.display = "block";
        form.reset();
        setTimeout(() => {
            successAlert.style.display = "none";
        }, 2000);
    })
        .catch((error) => {
            console.error('Error writing document: ', error);
            errorAlert.style.display = "block";
        });

    setTimeout(() => {
        successAlert.style.display = "none";
        errorAlert.style.display = "none";
    }, 2000);

})