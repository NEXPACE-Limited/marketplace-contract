import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  solidity: {
    version: "0.8.19",
    settings: {
      metadata: {
        bytecodeHash: "none",
      },
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 5000,
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    gasPrice: 21,
    token: "MATIC",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
