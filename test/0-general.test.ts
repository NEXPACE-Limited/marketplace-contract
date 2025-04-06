import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("General", function () {
  async function fixture() {
    const [owner, ad1] = await ethers.getSigners();
    const Marketplace = await ethers.getContractFactory("Marketplace");

    // commission contract
    const Commission = await ethers.getContractFactory("Commission");
    const Erc20 = await ethers.getContractFactory("ERC20PresetFixedSupply");
    const erc20 = await Erc20.deploy("TEST", "TEST", 100_000_000n, await owner.getAddress());
    await erc20.deployed();
    const commission = await Commission.deploy(ad1.address, erc20.address);
    await commission.connect(owner).deployed();

    const marketplace = await Marketplace.deploy(commission.address, erc20.address);

    return {
      owner,
      marketplace,
    };
  }

  before(async () => {
    await loadFixture(fixture);
  });

  it("Owner should be deployer", async () => {
    const { owner, marketplace } = await loadFixture(fixture);
    expect(await marketplace.owner()).to.equal(await owner.getAddress());
  });
});
