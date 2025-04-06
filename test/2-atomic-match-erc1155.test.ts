import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { now, day, signForBuyer, BuyerOrderStruct, signForSeller, SellerOrderStruct } from "./lib";
import nxErrors from "./lib/nx-errors";

describe("Exchange1155", function () {
  async function fixture() {
    const index = 0;
    const zeroAddress = ethers.constants.AddressZero;
    const nowTime = await now();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const [owner, ad1, buyer, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, nexonCommissionWallet] =
      await ethers.getSigners();
    const sellers = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9];

    const [Marketplace, ERC20PresetFixedSupply, ERC1155PresetMinterPauser, Commission] = await Promise.all([
      ethers.getContractFactory("Marketplace"),
      ethers.getContractFactory("ERC20PresetFixedSupply"),
      ethers.getContractFactory("ERC1155PresetMinterPauser"),
      ethers.getContractFactory("Commission"),
    ]);

    const [erc20PresetFixedSupply, erc1155PresetMinterPauser] = await Promise.all([
      ERC20PresetFixedSupply.deploy("ERC20", "ERC20", 20000, await buyer.getAddress()),
      ERC1155PresetMinterPauser.deploy(""),
    ]);

    const commission = await Commission.deploy(ad1.address, erc20PresetFixedSupply.address);
    await commission.connect(owner).deployed();
    const marketplace = await Marketplace.deploy(commission.address, erc20PresetFixedSupply.address);

    const defaultSellerOrder: SellerOrderStruct = {
      sellerAddress: "",
      listingTime: nowTime - 5 * day,
      expirationTime: nowTime + 9 * day,
      tokenAddress: erc20PresetFixedSupply.address,
      tokenAmount: 100,
      ftAddress: erc1155PresetMinterPauser.address,
      ftTokenId: index,
      ftAmounts: 100,
      salt: index,
    };

    const defaultBuyerOrder: BuyerOrderStruct = {
      buyerAddress: await buyer.getAddress(),
      ftAddress: erc1155PresetMinterPauser.address,
      ftTokenId: index,
      ticketIds: [],
      amounts: [],
      tokenAddress: erc20PresetFixedSupply.address,
      totalPrice: 0,
      salt: index,
    };

    const contentsCommissionInformation = {
      commissionTo: await nexonCommissionWallet.getAddress(),
      commissionPercentage: 500,
      dAppId: 0,
    };

    const mintAndAprv = async () => {
      const approveTx = await erc20PresetFixedSupply.connect(buyer).approve(marketplace.address, 100000);
      await approveTx.wait();
      for (let i = 0; i < 10; i++) {
        const mintTx = await erc1155PresetMinterPauser.mint(await sellers[i].getAddress(), index, 100, "0x00");
        await mintTx.wait();
        const approvalTx = await erc1155PresetMinterPauser
          .connect(sellers[i])
          .setApprovalForAll(marketplace.address, true);
        await erc20PresetFixedSupply.connect(sellers[i]).approve(marketplace.address, 1000);
        await approvalTx.wait();
      }
    };

    await Promise.all([await mintAndAprv()]);

    return {
      index,
      nowTime,
      chainId,
      zeroAddress,
      owner,
      buyer,
      sellers,
      marketplace,
      erc20PresetFixedSupply,
      erc1155PresetMinterPauser,
      defaultSellerOrder,
      defaultBuyerOrder,
      contentsCommissionInformation,
      nexonCommissionWallet,
      commission,
    };
  }

  before(async () => {
    await loadFixture(fixture);
  });

  it("Check fill's amount", async () => {
    const { sellers, marketplace, defaultSellerOrder } = await loadFixture(fixture);

    const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[0].getAddress() };
    const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);

    const txn = marketplace.fillsAmounts(sellerHash);
    expect(await txn).equal(0);
  });

  it("Buyer hashorder & validate signature", async () => {
    const { chainId, buyer, marketplace, defaultBuyerOrder } = await loadFixture(fixture);

    const buyerOrder = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const buyerHash = await marketplace.hashBuyerOrder1155(buyerOrder);
    const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);

    expect(await marketplace.validateSignature(buyerHash, await buyer.getAddress(), buyerSig)).to.equal(true);
  });

  describe("Success case", function () {
    it("Exchange with 10 sellers", async () => {
      const {
        chainId,
        marketplace,
        erc20PresetFixedSupply,
        erc1155PresetMinterPauser,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
        commission,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 9; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }
      const sellerOrder = {
        ...defaultSellerOrder,
        sellerAddress: await sellers[9].getAddress(),
        expirationTime: 0,
        salt: 9,
      };
      const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace.address, sellers[9], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      marketplace.validateSignature(sellerOrderHashs[9], await sellers[9].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[9];

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = await marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await txn.wait();

      expect(await erc1155PresetMinterPauser.balanceOf(await buyer.getAddress(), 0)).equal(100);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(500);
    });
  });
  describe("Fail case", function () {
    it("CancelOrder - executor", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[0].getAddress(), salt: 0 };
      const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace.address, sellers[0], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[0];

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      await marketplace.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      const txn = marketplace.connect(buyer).cancelOrder1155(sellerOrder, sellerSig, 5);
      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });

    it("CancelOrder - Value is must be same as order's nftAmount", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[0].getAddress(), salt: 0 };
      const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace.address, sellers[0], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[0];

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      await marketplace.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      const txn = marketplace.cancelOrder1155(sellerOrder, sellerSig, 5);
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.cancelConflict);
    });

    it("Buyer has not enough tokens", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 10; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(100);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.transferNoFund);
    });

    it("Amount exceeds stock", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 1; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        await expect(marketplace.cancelOrder1155(sellerOrder, sellerSig, 99))
          .to.emit(marketplace, "Order1155Canceled")
          .withArgs(sellerHash, 99);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.soldOut);
    });

    it("Wrong order length - wrong amounts field", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong order length - wrong ticketIds field", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong order length - wrong seller orders length", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong ticketId", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const wrongOrder = { ...sellerOrder, salt: i + 1 };
        const sellerHash = await marketplace.hashSellerOrder1155(wrongOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong ftAddress", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ftAddress: buyer.address,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: sellers[i].address, salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong tokenAddress", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = {
          ...defaultSellerOrder,
          sellerAddress: sellers[i].address,
          tokenAddress: sellers[i].address,
          salt: i,
        };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong ftTokenId", async () => {
      const {
        chainId,
        index,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ftTokenId: index + 1,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: sellers[i].address, salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Wrong listingTime", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        nowTime,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = {
          ...defaultSellerOrder,
          sellerAddress: sellers[i].address,
          listingTime: nowTime + day,
          salt: i,
        };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.sellerOrderNotListed);
    });
    it("Wrong expirationTime", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        nowTime,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = {
          ...defaultSellerOrder,
          sellerAddress: sellers[i].address,
          expirationTime: nowTime - 10 * day,
          salt: i,
        };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.sellerOrderExpired);
    });
    it("Used buyer hash - order duplicated", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = {
        ...defaultBuyerOrder,
        ticketIds: [],
        amounts: [],
      };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = {
          ...defaultSellerOrder,
          sellerAddress: sellers[i].address,
          salt: i,
        };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      await marketplace.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);
      const txn = marketplace.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.orderAlreadyUsed);
    });
    it("Executor - Caller is not the executor", async () => {
      const {
        chainId,
        marketplace,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 2; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
      const txn = marketplace
        .connect(buyer)
        .atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
  });
  it("Commission - content commission send zeroAddress", async () => {
    const {
      chainId,
      zeroAddress,
      marketplace,
      buyer,
      sellers,
      defaultBuyerOrder,
      defaultSellerOrder,
      contentsCommissionInformation,
    } = await loadFixture(fixture);
    const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const sellerOrders = [];
    const sellerOrderHashs = [];
    const sellerSigs = [];

    const wrongContentsCommissionInformation = {
      ...contentsCommissionInformation,
      commissionTo: zeroAddress,
    };

    for (let i = 0; i < 1; i++) {
      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
      const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerOrderHashs.push(sellerHash);
      sellerSigs.push(sellerSig);
      marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
    }

    const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
    const txn = marketplace.atomicMatch1155(
      sellerOrders,
      buyerOrder,
      sellerSigs,
      buyerSig,
      wrongContentsCommissionInformation
    );
    await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
  });
  it("Commission - content commission is over 100percent", async () => {
    const {
      chainId,
      marketplace,
      buyer,
      sellers,
      defaultBuyerOrder,
      defaultSellerOrder,
      contentsCommissionInformation,
    } = await loadFixture(fixture);
    const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const sellerOrders = [];
    const sellerOrderHashs = [];
    const sellerSigs = [];

    const wrongContentsCommissionInformation = {
      ...contentsCommissionInformation,
      commissionPercentage: 10001,
    };

    for (let i = 0; i < 1; i++) {
      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
      const sellerHash = await marketplace.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace.address, sellers[i], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerOrderHashs.push(sellerHash);
      sellerSigs.push(sellerSig);
      marketplace.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
    }

    const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);
    const txn = marketplace.atomicMatch1155(
      sellerOrders,
      buyerOrder,
      sellerSigs,
      buyerSig,
      wrongContentsCommissionInformation
    );
    await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
  });
});
