import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCVA4IF1-986N3nIa2-YfYPAl492f7bpMM',
  authDomain: 'ryder-cup-f637c.firebaseapp.com',
  databaseURL: 'https://ryder-cup-f637c-default-rtdb.firebaseio.com',
  projectId: 'ryder-cup-f637c',
  storageBucket: 'ryder-cup-f637c.firebasestorage.app',
  messagingSenderId: '332375999074',
  appId: '1:332375999074:web:1630d43d63e9459b4d473b',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
