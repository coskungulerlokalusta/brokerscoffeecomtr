// Ürün kategorilerini personel indirim gruplarına eşler.
// Yeni bir kategori eklenirse (örn. gerçek "Şişe İçecekler" ürünleri), aşağıdaki
// listeye eklemek yeterli.
const GROUPS = [
  {
    key: 'kahve_icecek',
    label: 'Kahve & Sıcak/Soğuk İçecekler',
    categories: ['Sıcak İçecekler', 'Soğuk İçecekler', 'Frappe', 'Frozen', 'Limonata', 'Farklı ve Tatlı Lezzetler'],
  },
  {
    key: 'pasta',
    label: 'Pasta & Kruvasan',
    categories: ['Kruvasanlar', 'Pasta', 'Pastalar'],
  },
  {
    key: 'sise_icecek',
    label: 'Şişe İçecekler',
    categories: ['Şişe İçecekler', 'Şişe İçecek'],
  },
];

const DEFAULT_GROUP_KEY = 'kahve_icecek';

// Bir ürünün kategori/alt kategorisine göre hangi indirim grubuna girdiğini bulur
function getGroupForProduct(product) {
  const cat = (product.subcategory || product.category || '').trim();
  const found = GROUPS.find((g) => g.categories.includes(cat));
  return found ? found.key : DEFAULT_GROUP_KEY;
}

module.exports = { GROUPS, DEFAULT_GROUP_KEY, getGroupForProduct };
