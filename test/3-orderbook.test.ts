import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { now, day, orderbookSignBuyer, orderbookSignSeller } from "./lib";
import nxErrors from "./lib/nx-errors";

describe("OrderBook", function () {
  async function fixture() {
    const index = 0;
    const nowTime = await now();
    const zeroAddress = ethers.constants.AddressZero;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const [owner, buyer, seller, nexonCommissionWallet] = await ethers.getSigners();
    const [OrderBook, ERC20PresetFixedSupply, MockMSU721, Commission] = await Promise.all([
      ethers.getContractFactory("OrderBook"),
      ethers.getContractFactory("ERC20PresetFixedSupply"),
      ethers.getContractFactory("MockMSU721"),
      ethers.getContractFactory("Commission"),
    ]);

    const [erc20PresetFixedSupply, erc721PresetMinterPauserAutoId] = await Promise.all([
      ERC20PresetFixedSupply.deploy("ERC20", "ERC20", 1000, await buyer.getAddress()),
      MockMSU721.deploy(),
    ]);

    const commission = await Commission.deploy(owner.address, erc20PresetFixedSupply.address);
    await commission.connect(owner).deployed();
    const orderbook = await OrderBook.deploy(commission.address, erc20PresetFixedSupply.address);
    const itemId = 123;

    const defaultSellerOrder = {
      maker: await seller.getAddress(),
      listingTime: nowTime - 5 * day,
      currencyAddress: erc20PresetFixedSupply.address,
      perPrice: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      nftTokenIds: [0, 1, 2, 3, 4],
      salt: index,
    };

    const defaultBuyerOrder = {
      maker: await buyer.getAddress(),
      listingTime: nowTime - 5 * day,
      currencyAddress: erc20PresetFixedSupply.address,
      perPrice: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      itemId: itemId,
      purchaseAmount: 100,
      salt: index,
    };

    const contentsCommissionInformation = {
      commissionTo: await nexonCommissionWallet.getAddress(),
      commissionPercentage: 500,
      dAppId: 0,
    };

    for (let i = 0; i < 10; i++) {
      await erc721PresetMinterPauserAutoId.mint(seller.address, itemId, i);
    }

    await Promise.all([
      await erc20PresetFixedSupply.connect(buyer).approve(orderbook.address, 1000),
      await erc20PresetFixedSupply.connect(seller).approve(orderbook.address, 1000),
      await erc721PresetMinterPauserAutoId.connect(seller).setApprovalForAll(orderbook.address, true),
    ]);

    return {
      index,
      nowTime,
      chainId,
      zeroAddress,
      nexonCommissionWallet,
      owner,
      buyer,
      seller,
      itemId,
      commission,
      orderbook,
      erc20PresetFixedSupply,
      erc721PresetMinterPauserAutoId,
      defaultSellerOrder,
      defaultBuyerOrder,
      contentsCommissionInformation,
    };
  }

  before(async () => {
    await loadFixture(fixture);
  });

  it("Check fill's amount", async () => {
    const { orderbook, defaultSellerOrder } = await loadFixture(fixture);

    const sellerHash = await orderbook.hashOrderBookSeller(defaultSellerOrder);

    const txn = orderbook.fillsAmounts(sellerHash);
    expect(await txn).equal(0);
  });

  it("Buyer hashorder & validate signature", async () => {
    const { chainId, buyer, orderbook, defaultBuyerOrder } = await loadFixture(fixture);

    const buyerHash = await orderbook.hashOrderBookBuyer(defaultBuyerOrder);
    const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, defaultBuyerOrder);

    expect(await orderbook.validateSignature(buyerHash, await buyer.getAddress(), buyerSig)).to.equal(true);
  });

  describe("Success case", function () {
    it("Fixed price order match", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        commission,
        defaultSellerOrder,
        defaultBuyerOrder,
        erc20PresetFixedSupply,
        erc721PresetMinterPauserAutoId,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerHash = await orderbook.hashOrderBookSeller(sellerOrder);
      const buyerHash = await orderbook.hashOrderBookBuyer(buyerOrder);

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = await orderbook.orderMatch(
        sellerOrder,
        buyerOrder,
        sellerSig,
        buyerSig,
        contentsCommissionInformation
      );

      await txn.wait();

      expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(500);
      expect(await erc20PresetFixedSupply.balanceOf(await seller.getAddress())).equal(475);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(25);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await buyer.getAddress())).equal(5);
      expect(await orderbook.fillsAmounts(sellerHash)).equal(5);
      expect(await orderbook.fillsAmounts(buyerHash)).equal(5);
    });
  });
  describe("Fail case", function () {
    it("Not executor - orderMatch", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook
        .connect(seller)
        .orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
    it("Not executor - cancel seller order", async () => {
      const { chainId, seller, orderbook, defaultSellerOrder } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);

      const txn = orderbook.connect(seller).cancelSellerOrderBook(sellerOrder, sellerSig, 5);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
    it("Not executor - cancel buyer order", async () => {
      const { chainId, buyer, orderbook, defaultBuyerOrder } = await loadFixture(fixture);

      const buyerOrder = defaultBuyerOrder;

      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.connect(buyer).cancelBuyerOrderBook(buyerOrder, buyerSig, 10);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
    it("Wrong commissionTo", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
        zeroAddress,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;
      const wrongCommission = {
        ...contentsCommissionInformation,
        commissionTo: zeroAddress,
      };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, wrongCommission);

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Wrong commissionPercentage", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;
      const wrongCommission = {
        ...contentsCommissionInformation,
        commissionPercentage: 10001,
      };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, wrongCommission);

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Not enough buyer token", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
        erc20PresetFixedSupply,
      } = await loadFixture(fixture);

      await erc20PresetFixedSupply.connect(buyer).transfer(seller.address, 1000);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.transferNoFund);
    });
    it("Different currency address", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, currencyAddress: buyer.address };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Different per price", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, perPrice: 200 };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Different nft address", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, nftAddress: seller.address };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Out of stock - buyer", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      await orderbook.cancelBuyerOrderBook(buyerOrder, buyerSig, 100);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.outOfStock);
    });
    it("Out of stock - seller", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      await orderbook.cancelSellerOrderBook(sellerOrder, sellerSig, 5);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.outOfStock);
    });
    it("Wrong item id", async () => {
      const {
        chainId,
        seller,
        buyer,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, itemId: 111 };

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.orderMatch(sellerOrder, buyerOrder, sellerSig, buyerSig, contentsCommissionInformation);
      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Cancel lower value - buyer", async () => {
      const { chainId, buyer, orderbook, defaultBuyerOrder } = await loadFixture(fixture);

      const buyerOrder = defaultBuyerOrder;

      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      await orderbook.cancelBuyerOrderBook(buyerOrder, buyerSig, 50);
      const txn = orderbook.cancelBuyerOrderBook(buyerOrder, buyerSig, 40);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.cancelConflict);
    });
    it("Cancel bigger value - buyer", async () => {
      const { chainId, buyer, orderbook, defaultBuyerOrder } = await loadFixture(fixture);

      const buyerOrder = defaultBuyerOrder;

      const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, buyer, buyerOrder);

      const txn = orderbook.cancelBuyerOrderBook(buyerOrder, buyerSig, 101);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.cancelConflict);
    });
    it("Cancel lower value - seller", async () => {
      const { chainId, seller, orderbook, defaultSellerOrder } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);

      await orderbook.cancelSellerOrderBook(sellerOrder, sellerSig, 4);
      const txn = orderbook.cancelSellerOrderBook(sellerOrder, sellerSig, 3);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.cancelConflict);
    });
    it("Cancel bigger value - seller", async () => {
      const { chainId, seller, orderbook, defaultSellerOrder } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);

      const txn = orderbook.cancelSellerOrderBook(sellerOrder, sellerSig, 6);
      await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.cancelConflict);
    });
  });
});
