window.CARDENIO = {
  zones: {
    patio: { title: 'Patio de butacas', rows: 15, odds: [21,19,17,15,13,11,9,7,5,3,1], evens: [2,4,6,8,10,12,14,16,18,20,22], price: 18 },
    preferencia: { title: 'Preferencia', rows: 9, odds: [17,15,13,11,9,7,5,3,1], evens: [2,4,6,8,10,12,14,16,18], price: 14 },
    palcos: { title: 'Palcos', price: 22 }
  },
  palcoGroups: [
    { key:'alto-impar', title:'PALCOS ALTO IMPAR', nums:[1,3,5,7,9,11,13,15,17,19,21,23,25,27,29] },
    { key:'bajo-impar', title:'PALCOS BAJO IMPAR', nums:[1,3,5,7,9,11,13,15,17,19,21,23] },
    { key:'bajo-par', title:'PALCOS BAJO PAR', nums:[2,4,6,8,10,12,14,16,18,20,22,24] },
    { key:'alto-par', title:'PALCOS ALTO PAR', nums:[2,4,6,8,10,12,14,16,18,20,22,24,26,28,30] }
  ]
};
