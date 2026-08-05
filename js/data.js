window.CARDENIO = {
  zones: {
    patio: {
      title: 'Patio de butacas',
      rows: 15,
      price: 18,
      rowRanges: [
        { from: 1, to: 9, odds: [21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1], evens: [2, 4, 6, 8, 10, 12, 14, 16, 18] },
        { from: 10, to: 15, odds: [17, 15, 13, 11, 9, 7, 5, 3, 1], evens: [2, 4, 6, 8, 10, 12, 14, 16, 18] }
      ]
    },
    preferencia: {
      title: 'Preferencia',
      rows: 9,
      startRow: 2,
      price: 14,
      rowRanges: [
        { from: 2, to: 3, odds: [17, 15, 13, 11, 9, 7, 5, 3, 1], evens: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24] },
        { from: 4, to: 9, odds: [17, 15, 13, 11, 9, 7, 5, 3, 1], evens: [2, 4, 6, 8, 10, 12, 14, 16, 18] }
      ]
    },
    palcos: {
      title: 'Palcos',
      price: 22
    }
  },
  palcoGroups: [
    { key: 'alto-impar', title: 'PALCOS ALTO IMPAR', nums: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21] },
    { key: 'bajo-impar', title: 'PALCOS BAJO IMPAR', nums: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21] },
    { key: 'bajo-par', title: 'PALCOS BAJO PAR', nums: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] },
    { key: 'alto-par', title: 'PALCOS ALTO PAR', nums: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] }
  ]
};
