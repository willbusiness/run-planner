import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const map = L.map('map').setView([-33.8688, 151.2093], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
