// Pure JS Cryptographic Blockchain Ledger for SHIELD System

// Simple synchronous SHA-256 implementation in pure Javascript
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j; // Used as a counter across the whole file
  var result = '';

  var words = [];
  var asciiLength = ascii[lengthProperty] * 8;
  
  var hash = sha256.h = sha256.h || [];
  var k = sha256.k = sha256.k || [];
  var primeCounter = k[lengthProperty];

  var isPrime = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isPrime[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isPrime[i] = 1;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
    }
  }
  
  ascii += '\x80'; // Append '1' bit and seven '0' bits
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00'; // Key padding
  
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return; // ASCII check
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiLength | 0);
  
  // Process each chunk
  for (j = 0; j < words[lengthProperty]; ) {
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0);
    
    hash = hash.slice(0, 8);
    
    for (i = 0; i < 64; i++) {
      var wItem = w[i];
      if (i >= 16) {
        var s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        wItem = w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      
      var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      var sigma0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      var sigma1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      
      var temp1 = (hash[7] + sigma1 + ch + k[i] + wItem) | 0;
      var temp2 = (sigma0 + maj) | 0;
      
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  
  for (i = 0; i < 8; i++) {
    var word = hash[i];
    // Convert to hex
    var hex = (word >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    result += hex;
  }
  return result;
}

// Transaction Class represents tourist telemetry, KYC, or incidents
class LedgerTransaction {
  constructor(type, details) {
    this.type = type; // 'KYC_REGISTER', 'SOS_TRIGGER', 'TELEMETRY_LOG', 'E-FIR_GENERATE'
    this.details = details; // data payload object
    this.timestamp = new Date().toISOString();
  }
}

// Block Class
class Block {
  constructor(index, transactions, previousHash = '') {
    this.index = index;
    this.timestamp = new Date().toISOString();
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return sha256(
      this.index +
      this.previousHash +
      this.timestamp +
      JSON.stringify(this.transactions) +
      this.nonce
    );
  }

  // Visual mine block (proof of work)
  mineBlock(difficulty) {
    const target = Array(difficulty + 1).join("0");
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

// Blockchain Class
class Blockchain {
  constructor() {
    this.difficulty = 2; // balanced difficulty for instant browser mining
    this.pendingTransactions = [];
    
    // Attempt to load existing chain from browser LocalStorage
    const savedChain = localStorage.getItem('shield_blockchain');
    if (savedChain) {
      try {
        const parsed = JSON.parse(savedChain);
        // Re-prototype instances back to Block objects
        this.chain = parsed.map(blockData => {
          const block = new Block(blockData.index, blockData.transactions, blockData.previousHash);
          block.timestamp = blockData.timestamp;
          block.nonce = blockData.nonce;
          block.hash = blockData.hash;
          return block;
        });
      } catch (err) {
        console.error("Failed loading saved blockchain, regenerating...", err);
        this.chain = [this.createGenesisBlock()];
      }
    } else {
      this.chain = [this.createGenesisBlock()];
    }
  }

  saveChain() {
    localStorage.setItem('shield_blockchain', JSON.stringify(this.chain));
  }

  createGenesisBlock() {
    const transaction = new LedgerTransaction('GENESIS', { message: "SHIELD Security Ledger Genesis Block Initialized" });
    return new Block(0, [transaction], "0000000000000000000000000000000000000000000000000000000000000000");
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(newBlock) {
    newBlock.previousHash = this.getLatestBlock().hash;
    newBlock.mineBlock(this.difficulty);
    this.chain.push(newBlock);
    this.saveChain();
  }

  // Create a block from pending transactions
  minePendingTransactions(validatorNodeName) {
    // Inject the validator signature
    const validatorTransaction = new LedgerTransaction('VALIDATION_SIGN', {
      node: validatorNodeName,
      status: "Approved & Audited"
    });
    
    const blockTransactions = [...this.pendingTransactions, validatorTransaction];
    const newBlock = new Block(this.chain.length, blockTransactions, this.getLatestBlock().hash);
    newBlock.mineBlock(this.difficulty);
    
    this.chain.push(newBlock);
    this.pendingTransactions = []; // clear pending
    this.saveChain();
    return newBlock;
  }

  createTransaction(type, details) {
    const tx = new LedgerTransaction(type, details);
    this.pendingTransactions.push(tx);
    return tx;
  }

  // Comprehensive chain validation (tamper-proofing check)
  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Re-calculate hash and check
      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return {
          valid: false,
          error: "TAMPER_DETECTED",
          blockIndex: i,
          message: `Block ${i} hash has been corrupted. Re-calculated: ${currentBlock.calculateHash().substring(0, 16)}... != Recorded: ${currentBlock.hash.substring(0, 16)}...`
        };
      }

      // Check linkage
      if (currentBlock.previousHash !== previousBlock.hash) {
        return {
          valid: false,
          error: "CHAIN_BROKEN",
          blockIndex: i,
          message: `Block ${i} previousHash link is broken. Link: ${currentBlock.previousHash.substring(0, 16)}... != Prev Block Hash: ${previousBlock.hash.substring(0, 16)}...`
        };
      }
    }
    return { valid: true };
  }
}

// Export classes to window object
window.LedgerTransaction = LedgerTransaction;
window.Block = Block;
window.Blockchain = Blockchain;
window.sha256 = sha256;

