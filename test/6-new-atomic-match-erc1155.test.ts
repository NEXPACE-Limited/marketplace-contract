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

    const [Marketplace, MarketplaceV2, ERC20PresetFixedSupply, ERC1155PresetMinterPauser, Commission] =
      await Promise.all([
        ethers.getContractFactory("Marketplace"),
        ethers.getContractFactory("MarketplaceV2"),
        ethers.getContractFactory("ERC20PresetFixedSupply"),
        ethers.getContractFactory("ERC1155PresetMinterPauser"),
        ethers.getContractFactory("Commission"),
      ]);

    const [erc20PresetFixedSupply, erc1155PresetMinterPauser] = await Promise.all([
      ERC20PresetFixedSupply.deploy("ERC20", "ERC20", 10500, await buyer.getAddress()),
      ERC1155PresetMinterPauser.deploy(""),
    ]);

    const commission = await Commission.deploy(ad1.address, erc20PresetFixedSupply.address);
    await commission.connect(owner).deployed();
    const marketplace = await Marketplace.deploy(commission.address, erc20PresetFixedSupply.address);
    const marketplace2 = await MarketplaceV2.deploy(
      commission.address,
      erc20PresetFixedSupply.address,
      marketplace.address
    );

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
      const approveTx2 = await erc20PresetFixedSupply.connect(buyer).approve(marketplace2.address, 100000);
      await approveTx.wait();
      await approveTx2.wait();
      for (let i = 0; i < 10; i++) {
        const mintTx = await erc1155PresetMinterPauser.mint(await sellers[i].getAddress(), index, 100, "0x00");
        await mintTx.wait();
        const approvalTx = await erc1155PresetMinterPauser
          .connect(sellers[i])
          .setApprovalForAll(marketplace.address, true);
        await erc20PresetFixedSupply.connect(sellers[i]).approve(marketplace.address, 1000);
        const approvalTx2 = await erc1155PresetMinterPauser
          .connect(sellers[i])
          .setApprovalForAll(marketplace2.address, true);
        await erc20PresetFixedSupply.connect(sellers[i]).approve(marketplace2.address, 1000);
        await approvalTx.wait();
        await approvalTx2.wait();
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
      marketplace2,
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

  it("Check v1 bug", async () => {
    const {
      chainId,
      marketplace,
      erc20PresetFixedSupply,
      buyer,
      sellers,
      defaultBuyerOrder,
      defaultSellerOrder,
      contentsCommissionInformation,
      commission,
    } = await loadFixture(fixture);
    await erc20PresetFixedSupply.connect(buyer).transfer(commission.address, 500);

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
    const txn = marketplace.atomicMatch1155(
      sellerOrders,
      buyerOrder,
      sellerSigs,
      buyerSig,
      contentsCommissionInformation
    );

    expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(10000);
    // 정확한 거래 값으로 거래 시도 시 ERC20 잔액부족 발생
    await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.transferNoFund);
  });

  it("Check fill's amount", async () => {
    const {
      chainId,
      marketplace2,
      erc20PresetFixedSupply,
      erc1155PresetMinterPauser,
      buyer,
      sellers,
      defaultBuyerOrder,
      defaultSellerOrder,
      contentsCommissionInformation,
      commission,
    } = await loadFixture(fixture);
    await erc20PresetFixedSupply.connect(buyer).transfer(commission.address, 500);

    const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const sellerOrders = [];
    const sellerOrderHashs = [];
    const sellerSigs = [];

    for (let i = 0; i < 9; i++) {
      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
    }
    const sellerOrder = {
      ...defaultSellerOrder,
      sellerAddress: await sellers[9].getAddress(),
      expirationTime: 0,
      salt: 9,
    };
    const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
    const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[9], sellerOrder);
    buyerOrder.ticketIds.push(sellerHash);
    sellerOrderHashs.push(sellerHash);
    sellerOrders.push(sellerOrder);
    sellerSigs.push(sellerSig);
    marketplace2.validateSignature(sellerOrderHashs[9], await sellers[9].getAddress(), sellerSig);
    buyerOrder.amounts.push(10);
    buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[9];

    const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);

    const txn = await marketplace2.atomicMatch1155(
      sellerOrders,
      buyerOrder,
      sellerSigs,
      buyerSig,
      contentsCommissionInformation
    );
    await txn.wait();

    expect(await erc1155PresetMinterPauser.balanceOf(await buyer.getAddress(), 0)).equal(100);
    expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(1000);
    expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(0);
    expect(await marketplace2.fillsAmounts(sellerHash)).equal(10);
  });

  it("Check fill's amount (had filled amounts in v1)", async () => {
    const {
      chainId,
      marketplace,
      marketplace2,
      erc20PresetFixedSupply,
      erc1155PresetMinterPauser,
      buyer,
      sellers,
      defaultBuyerOrder,
      defaultSellerOrder,
      contentsCommissionInformation,
      commission,
    } = await loadFixture(fixture);
    await erc20PresetFixedSupply.connect(buyer).transfer(commission.address, 500);

    const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const sellerOrders = [];
    const sellerOrderHashs = [];
    const sellerSigs = [];

    for (let i = 0; i < 9; i++) {
      const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
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

    await marketplace.cancelOrder1155(sellerOrder, sellerSig, 5); // 5개 v1에서 취소 (fillsAmount +5)
    expect(await marketplace2.fillsAmounts(sellerHash)).equal(5);
    buyerOrder.ticketIds.push(sellerHash);
    sellerOrderHashs.push(sellerHash);
    sellerOrders.push(sellerOrder);
    sellerSigs.push(sellerSig);
    marketplace2.validateSignature(sellerOrderHashs[9], await sellers[9].getAddress(), sellerSig);
    buyerOrder.amounts.push(3); // 3개 v2에서 구매 (fillsAmount +3)
    buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[9];

    const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);

    const txn = await marketplace2.atomicMatch1155(
      sellerOrders,
      buyerOrder,
      sellerSigs,
      buyerSig,
      contentsCommissionInformation
    );
    await txn.wait();

    expect(await erc1155PresetMinterPauser.balanceOf(await buyer.getAddress(), 0)).equal(93);
    expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(965);
    expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(700);
    expect(await marketplace2.fillsAmounts(sellerHash)).equal(8);
  });

  it("Buyer hashorder & validate signature", async () => {
    const { chainId, buyer, marketplace2, defaultBuyerOrder } = await loadFixture(fixture);

    const buyerOrder = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const buyerHash = await marketplace2.hashBuyerOrder1155(buyerOrder);
    const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);

    expect(await marketplace2.validateSignature(buyerHash, await buyer.getAddress(), buyerSig)).to.equal(true);
  });

  it("Buyer hashorder & validate signature from market v2 by market v1 signature", async () => {
    const { chainId, buyer, marketplace, marketplace2, defaultBuyerOrder } = await loadFixture(fixture);

    const buyerOrder = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
    const buyerHash = await marketplace.hashBuyerOrder1155(buyerOrder);
    const buyerSig = await signForBuyer(chainId, marketplace.address, buyer, buyerOrder);

    expect(await marketplace2.validateSignature(buyerHash, await buyer.getAddress(), buyerSig)).to.equal(true);
    // v1 전자서명 값 v2 validateSignature(external) 함수로 확인 가능
  });

  describe("Success case", function () {
    it("Exchange with 10 sellers v2", async () => {
      const {
        chainId,
        marketplace2,
        erc20PresetFixedSupply,
        erc1155PresetMinterPauser,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
        commission,
      } = await loadFixture(fixture);
      await erc20PresetFixedSupply.connect(buyer).transfer(commission.address, 500);

      const buyerOrder: BuyerOrderStruct = { ...defaultBuyerOrder, ticketIds: [], amounts: [] };
      const sellerOrders = [];
      const sellerOrderHashs = [];
      const sellerSigs = [];

      for (let i = 0; i < 9; i++) {
        const sellerOrder = { ...defaultSellerOrder, sellerAddress: await sellers[i].getAddress(), salt: i };
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }
      const sellerOrder = {
        ...defaultSellerOrder,
        sellerAddress: await sellers[9].getAddress(),
        expirationTime: 0,
        salt: 9,
      };
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[9], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      marketplace2.validateSignature(sellerOrderHashs[9], await sellers[9].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[9];

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = await marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await txn.wait();

      expect(await erc1155PresetMinterPauser.balanceOf(await buyer.getAddress(), 0)).equal(100);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(1000);
      expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(0);
      // v1 버그 조치 확인
    });
    it("Exchange with 9 sellers v1 + 1 seller v2", async () => {
      const {
        chainId,
        marketplace,
        marketplace2,
        erc20PresetFixedSupply,
        erc1155PresetMinterPauser,
        buyer,
        sellers,
        defaultBuyerOrder,
        defaultSellerOrder,
        contentsCommissionInformation,
        commission,
      } = await loadFixture(fixture);
      await erc20PresetFixedSupply.connect(buyer).transfer(commission.address, 500);

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
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[9], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      marketplace2.validateSignature(sellerOrderHashs[9], await sellers[9].getAddress(), sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[9];

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = await marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await txn.wait();

      expect(await erc1155PresetMinterPauser.balanceOf(await buyer.getAddress(), 0)).equal(100);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(1000);
      expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(0);
    });
  });
  describe("Fail case", function () {
    it("CancelOrder - executor", async () => {
      const {
        chainId,
        marketplace2,
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
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[0], sellerOrder);
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[0];

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      await marketplace2.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      const txn = marketplace2.connect(buyer).cancelOrder1155(sellerOrder, sellerSig, 5);
      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });

    it("CancelOrder - invalid seller signature", async () => {
      const {
        chainId,
        marketplace2,
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
      const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
      const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[0], sellerOrder);
      const wrongSellerSig = (await signForSeller(chainId, marketplace2.address, sellers[0], sellerOrder)).replace(
        "4",
        "5"
      );
      buyerOrder.ticketIds.push(sellerHash);
      sellerOrderHashs.push(sellerHash);
      sellerOrders.push(sellerOrder);
      sellerSigs.push(sellerSig);
      buyerOrder.amounts.push(10);
      buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[0];

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      await marketplace2.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      const txn = marketplace2.cancelOrder1155(sellerOrder, wrongSellerSig, 5);
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.invalidSignature);
    });

    it("Buyer has not enough tokens", async () => {
      const {
        chainId,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(100);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.transferNoFund);
    });

    it("Amount exceeds stock after cancel order from market v1", async () => {
      const {
        chainId,
        marketplace,
        marketplace2,
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
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.soldOut);
    });

    it("Amount exceeds stock after cancel order from market v2 by market v1 signature", async () => {
      const {
        chainId,
        marketplace,
        marketplace2,
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
        await expect(marketplace2.cancelOrder1155(sellerOrder, sellerSig, 99))
          .to.emit(marketplace2, "Order1155Canceled")
          .withArgs(sellerHash, 99);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.soldOut);
    });

    it("Amount exceeds stock after cancel order", async () => {
      const {
        chainId,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        await expect(marketplace2.cancelOrder1155(sellerOrder, sellerSig, 99))
          .to.emit(marketplace2, "Order1155Canceled")
          .withArgs(sellerHash, 99);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(wrongOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      await marketplace2.atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.orderAlreadyUsed);
    });
    it("Invalid buyer signature", async () => {
      const {
        chainId,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], sellers[i].address, sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = (await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder)).replace("4", "5");
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.invalidSignature);
    });
    it("invalid seller signature", async () => {
      const {
        chainId,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = (await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder)).replace(
          "4",
          "5"
        );
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        contentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.Exchange1155.invalidSignature);
    });
    it("Executor - Caller is not the executor", async () => {
      const {
        chainId,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrderHashs.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2
        .connect(buyer)
        .atomicMatch1155(sellerOrders, buyerOrder, sellerSigs, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
    it("Commission - content commission send zeroAddress", async () => {
      const {
        chainId,
        zeroAddress,
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
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
        marketplace2,
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
        const sellerHash = await marketplace2.hashSellerOrder1155(sellerOrder);
        const sellerSig = await signForSeller(chainId, marketplace2.address, sellers[i], sellerOrder);
        buyerOrder.ticketIds.push(sellerHash);
        sellerOrders.push(sellerOrder);
        sellerOrderHashs.push(sellerHash);
        sellerSigs.push(sellerSig);
        marketplace2.validateSignature(sellerOrderHashs[i], await sellers[i].getAddress(), sellerSig);
        buyerOrder.amounts.push(10);
        buyerOrder.totalPrice += sellerOrder.tokenAmount * buyerOrder.amounts[i];
      }

      const buyerSig = await signForBuyer(chainId, marketplace2.address, buyer, buyerOrder);
      const txn = marketplace2.atomicMatch1155(
        sellerOrders,
        buyerOrder,
        sellerSigs,
        buyerSig,
        wrongContentsCommissionInformation
      );
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
  });
});
